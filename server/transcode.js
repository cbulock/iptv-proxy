import { spawn } from 'child_process';
import { getChannels } from '../libs/channels-cache.js';

/**
 * Set up the server-side transcoding route.
 * GET /transcode/:source/:name
 *
 * Transcodes the upstream MPEG-TS stream to H.264/AAC in MPEG-TS format using
 * ffmpeg, allowing browsers to play streams that use unsupported codecs
 * (e.g. MPEG-2 video / AC-3 audio from HDHomeRun OTA tuners).
 *
 * Requires ffmpeg to be installed on the server.
 * Returns 503 when ffmpeg is unavailable.
 *
 * @param {import('express').Application} app
 */
export function setupTranscodeRoutes(app) {
  app.get('/transcode/:source/:name', (req, res) => {
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
      '-c:a',
      'aac',
      '-f',
      'mpegts',
      'pipe:1',
    ];

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    res.setHeader('Content-Type', 'video/MP2T');
    res.setHeader('Cache-Control', 'no-cache, no-store');

    // Register error handler before piping to ensure it fires before any response data is written.
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
      console.warn('[transcode] ffmpeg: %s/%s: %s', source, name, data.toString().trim());
    });

    ffmpegProcess.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.warn('[transcode] ffmpeg exited with code %d for %s/%s', code, source, name);
      } else if (signal) {
        console.info('[transcode] ffmpeg stopped (%s) for %s/%s', signal, source, name);
      }
      if (!res.writableEnded) {
        res.end();
      }
    });

    ffmpegProcess.stdout.pipe(res);

    // Kill ffmpeg when the client disconnects to free up CPU/network resources.
    // Guard against calling kill() on a process that has already exited naturally.
    req.on('close', () => {
      if (ffmpegProcess.exitCode === null && !ffmpegProcess.killed) {
        ffmpegProcess.kill('SIGTERM');
      }
    });
  });
}
