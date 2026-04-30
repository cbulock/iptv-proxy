import { spawn } from 'child_process';
import RateLimit from 'express-rate-limit';
import { getChannels } from '../libs/channels-cache.js';

// Rate limiter for the transcoding endpoint — each ffmpeg process consumes significant
// CPU and network resources, so keep the per-IP limit stricter than other endpoints.
const transcodeLimiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // limit each IP to 5 concurrent-ish transcode requests per minute
  skip: req => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: req => req.ip || 'unknown',
  message: {
    error: 'Too many transcoding requests from this IP, please try again later.',
  },
});

/**
 * Set up the server-side transcoding route.
 * GET /transcode/:source/:name
 *
 * Transcodes the upstream MPEG-TS stream to H.264/AAC in MPEG-TS format using
 * ffmpeg, allowing browsers to play streams that use unsupported codecs
 * (e.g. MPEG-2 video / AC-3 audio from HDHomeRun OTA tuners).
 *
 * This route is public and rate-limited to prevent resource exhaustion from
 * spawning excessive ffmpeg processes.
 *
 * Requires ffmpeg to be installed on the server.
 * Returns 503 when ffmpeg is unavailable.
 *
 * @param {import('express').Application} app
 */
export function setupTranscodeRoutes(app) {
  app.get('/transcode/:source/:name', transcodeLimiter, (req, res) => {
    const { source, name } = req.params;
    const channels = getChannels();
    const channel = channels.find(c => c.source === source && c.name === name);

    if (!channel) {
      return res.status(404).send('Channel not found');
    }

    const upstreamUrl = channel.original_url;
    if (!upstreamUrl) {
      return res.status(404).send('No upstream URL for channel');
    }

    console.info('[transcode] %s/%s -> %s', source, name, upstreamUrl);

    // Transcode the upstream stream to H.264/AAC in MPEG-TS format.
    // -preset ultrafast and -tune zerolatency minimise encoder latency for live streams.
    // -pix_fmt yuv420p ensures 8-bit 4:2:0 output required by browser MSE decoders.
    // -ac 2 downmixes to stereo so all browsers can decode the AAC track; HDHomeRun
    //   OTA broadcasts often carry AC-3 5.1 which would otherwise be re-encoded as
    //   6-channel AAC — a format rejected by some browser MSE implementations.
    // -b:a 128k provides a consistent, broadly-supported audio bitrate.
    const ffmpegArgs = [
      '-loglevel',
      'error',
      '-i',
      upstreamUrl,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-b:a',
      '128k',
      '-f',
      'mpegts',
      'pipe:1',
    ];

    const ffmpegProcess =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'ffmpeg', ...ffmpegArgs], {
            windowsHide: true,
          })
        : spawn('ffmpeg', ffmpegArgs);

    res.setHeader('Content-Type', 'video/MP2T');
    res.setHeader('Cache-Control', 'no-cache, no-store');

    // Track whether any stdout data has been written to the response.  We cannot
    // use pipe() directly because pipe() auto-calls res.end() when stdout ends,
    // which fires before the 'exit' event — making it impossible to detect a
    // non-zero exit code before headers are committed.
    let responseStarted = false;
    let stderrText = '';

    // Register error handler before attaching stdout to ensure it fires before
    // any response data is written (handles ENOENT / spawn failures).
    ffmpegProcess.on('error', err => {
      console.warn('[transcode] spawn error %s/%s: %s', source, name, err.message);
      if (!res.headersSent) {
        if (err.code === 'ENOENT') {
          res.status(503).json({
            error:
              'ffmpeg is not installed on this server. Install ffmpeg to enable server-side transcoding.',
          });
        } else {
          res.status(502).json({ error: 'Transcoding failed' });
        }
      } else {
        res.end();
      }
    });

    ffmpegProcess.stderr.on('data', data => {
      const text = data.toString();
      stderrText += text;
      console.warn('[transcode] ffmpeg: %s/%s: %s', source, name, text.trim());
    });

    ffmpegProcess.stdout.on('data', chunk => {
      // Guard against writing to a destroyed/closed response (e.g. client disconnected).
      if (!res.writable) return;
      responseStarted = true;
      res.write(chunk);
    });

    // Only finalize when data was already sent; the exit handler owns the
    // no-data error path and will call res.end() when appropriate.
    ffmpegProcess.stdout.on('end', () => {
      if (responseStarted && !res.writableEnded) {
        res.end();
      }
    });

    ffmpegProcess.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.warn('[transcode] ffmpeg exited with code %d for %s/%s', code, source, name);
        if (!responseStarted && !res.headersSent) {
          const ffmpegMissingOnWindows =
            process.platform === 'win32' &&
            /not recognized as an internal or external command/i.test(stderrText);
          if (ffmpegMissingOnWindows) {
            return res.status(503).json({
              error:
                'ffmpeg is not installed on this server. Install ffmpeg to enable server-side transcoding.',
            });
          }
          return res.status(502).json({
            error: 'Transcoding failed',
            details: `ffmpeg exited with code ${code}`,
          });
        }
      } else if (signal) {
        console.info('[transcode] ffmpeg stopped (%s) for %s/%s', signal, source, name);
      }
      if (!res.writableEnded) {
        res.end();
      }
    });

    // Kill ffmpeg when the client disconnects to free up CPU/network resources.
    // Guard against calling kill() on a process that has already exited naturally.
    req.on('close', () => {
      if (ffmpegProcess.exitCode === null && !ffmpegProcess.killed) {
        ffmpegProcess.kill('SIGTERM');
      }
    });
  });
}
