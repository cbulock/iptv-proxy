import { spawn } from 'child_process';
import RateLimit from 'express-rate-limit';
import { getChannels } from '../libs/channels-cache.js';
import { getSourceChannelById } from '../libs/source-channel-resolver.js';
import { readUsageIdentity } from './usage.js';

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

// A request rate is not a bound on the amount of work currently running. Keep
// this intentionally small: every worker encodes video and can consume a core.
function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_ACTIVE_WORKERS = positiveInteger(process.env.TRANSCODE_MAX_WORKERS, 3);
const STARTUP_TIMEOUT_MS = positiveInteger(process.env.TRANSCODE_STARTUP_TIMEOUT_MS, 15000);
const IDLE_TIMEOUT_MS = positiveInteger(process.env.TRANSCODE_IDLE_TIMEOUT_MS, 30000);
const KILL_GRACE_MS = 5000;

function ffmpegCommand() {
  // Do not invoke cmd.exe: an upstream URL is untrusted input and cmd parsing
  // treats ordinary URL characters such as &, % and spaces as syntax.
  return process.env.FFMPEG_PATH || (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

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
export function setupTranscodeRoutes(app, dependencies = {}) {
  const activeWorkers = new Set();
  const spawnWorker = dependencies.spawn || spawn;
  const loadChannels = dependencies.getChannels || getChannels;
  const maxWorkers = dependencies.maxWorkers || MAX_ACTIVE_WORKERS;
  const registerUsage = dependencies.registerUsage || (async () => null);
  const touchUsage = dependencies.touchUsage || (() => {});
  const unregisterUsage = dependencies.unregisterUsage || (() => {});
  const usageHeartbeatMs = dependencies.usageHeartbeatMs || 10000;
  app.get('/transcode/:source/:name', transcodeLimiter, (req, res) => {
    let { source, name } = req.params;
    const channels = loadChannels();
    const channel =
      source === 'channel'
        ? getSourceChannelById(name)
        : channels.find(c => c.source === source && c.name === name);
    if (channel) {
      source = channel.source;
      name = channel.name;
    }

    if (!channel) {
      return res.status(404).send('Channel not found');
    }

    const upstreamUrl = channel.original_url;
    if (!upstreamUrl) {
      return res.status(404).send('No upstream URL for channel');
    }

    if (activeWorkers.size >= maxWorkers) {
      return res.status(503).json({
        error: 'Transcoding capacity is currently exhausted. Please try again later.',
        code: 'TRANSCODE_CAPACITY',
      });
    }

    console.info('[transcode] Starting %s/%s', source, name);

    // Transcode the upstream stream to H.264/AAC in MPEG-TS format.
    // -preset ultrafast and -tune zerolatency minimise encoder latency for live streams.
    // -pix_fmt yuv420p ensures 8-bit 4:2:0 output required by browser MSE decoders.
    // Deinterlace flagged interlaced frames before encoding so combing is not
    // baked into H.264. One frame per field preserves 59.94 Hz broadcast motion;
    // automatic field order follows the decoder, and progressive frames pass through.
    // -ac 2 downmixes to stereo so all browsers can decode the AAC track; HDHomeRun
    //   OTA broadcasts often carry AC-3 5.1 which would otherwise be re-encoded as
    //   6-channel AAC — a format rejected by some browser MSE implementations.
    // -b:a 128k provides a consistent, broadly-supported audio bitrate.
    const ffmpegArgs = [
      '-loglevel',
      'error',
      '-i',
      upstreamUrl,
      '-vf',
      'bwdif=mode=send_field:parity=auto:deint=interlaced',
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

    let ffmpegProcess;
    try {
      ffmpegProcess = spawnWorker(ffmpegCommand(), ffmpegArgs, {
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      // child_process.spawn normally reports failures through its error event,
      // but can throw synchronously for OS policy failures and invalid commands.
      console.warn('[transcode] spawn error %s/%s: %s', source, name, err.message);
      if (err.code === 'ENOENT') {
        return res.status(503).json({
          error: 'ffmpeg is unavailable on this server.',
          code: 'TRANSCODE_UNAVAILABLE',
        });
      }
      return res.status(502).json({ error: 'Transcoding failed', code: 'TRANSCODE_FAILED' });
    }
    activeWorkers.add(ffmpegProcess);

    res.setHeader('Content-Type', 'video/MP2T');
    res.setHeader('Cache-Control', 'no-cache, no-store');

    // Track whether any stdout data has been written to the response.  We cannot
    // use pipe() directly because pipe() auto-calls res.end() when stdout ends,
    // which can fire before the process closes — making it impossible to detect a
    // non-zero exit code before headers are committed.
    let responseStarted = false;
    let closed = false;
    let exited = false;
    let stopping = false;
    let idleTimer;
    let forceKillTimer;
    let usageKeyPromise;
    let usageInterval;
    let usageReleased = false;
    const releaseUsage = () => {
      if (usageReleased) return;
      usageReleased = true;
      clearInterval(usageInterval);
      usageKeyPromise?.then(key => {
        if (key) unregisterUsage(key);
      });
    };

    const stopWorker = () => {
      if (closed || exited || stopping) return;
      stopping = true;
      clearTimeout(startupTimer);
      clearTimeout(idleTimer);
      try {
        ffmpegProcess.kill('SIGTERM');
      } catch {
        /* keep capacity until close */
      }
      forceKillTimer = setTimeout(() => {
        if (!closed && !exited) {
          try {
            ffmpegProcess.kill('SIGKILL');
          } catch {
            /* a failed signal does not release capacity */
          }
        }
      }, KILL_GRACE_MS);
      forceKillTimer.unref?.();
    };
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearTimeout(startupTimer);
      clearTimeout(idleTimer);
      clearTimeout(forceKillTimer);
      activeWorkers.delete(ffmpegProcess);
      releaseUsage();
    };
    const fail = (status, error, code) => {
      if (res.writableEnded || res.destroyed) return;
      if (!res.headersSent) res.status(status).json({ error, code });
      else res.end();
    };
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        stopWorker();
        if (!res.writableEnded) res.end();
      }, IDLE_TIMEOUT_MS);
      idleTimer.unref?.();
    };
    const startupTimer = setTimeout(() => {
      if (!responseStarted) {
        stopWorker();
        fail(504, 'Transcoding startup timed out', 'TRANSCODE_STARTUP_TIMEOUT');
      }
    }, STARTUP_TIMEOUT_MS);
    startupTimer.unref?.();
    resetIdleTimer();

    ffmpegProcess.on('error', err => {
      // A spawn failure has no process. Errors while signalling a running
      // process cannot be taken as evidence that the process exited.
      if (!ffmpegProcess.pid) cleanup();
      else stopWorker();
      fail(
        err.code === 'ENOENT' ? 503 : 502,
        err.code === 'ENOENT' ? 'ffmpeg is unavailable on this server.' : 'Transcoding failed',
        err.code === 'ENOENT' ? 'TRANSCODE_UNAVAILABLE' : 'TRANSCODE_FAILED'
      );
    });
    // Drain stderr without returning provider URLs or decoder details to clients.
    ffmpegProcess.stderr.on('data', () => {});
    ffmpegProcess.stderr.on('error', () => {});
    ffmpegProcess.stdout.on('data', chunk => {
      if (!res.writable || res.writableEnded || res.destroyed || stopping) return;
      if (!usageKeyPromise) {
        const identity = readUsageIdentity(req);
        usageKeyPromise = Promise.resolve()
          .then(() =>
            registerUsage({
              ip: String(req.ip || req.socket?.remoteAddress || ''),
              channelId: String(channel.guideNumber || channel.tvg_id || channel.name),
              userAgent: req.headers['user-agent'] || '',
              ...identity,
            })
          )
          .then(key => {
            if (key && !usageReleased) {
              usageInterval = setInterval(() => touchUsage(key), usageHeartbeatMs);
              usageInterval.unref?.();
            }
            return key;
          })
          .catch(err => {
            console.warn('[transcode] usage registration failed: %s', err.message);
            return null;
          });
      }
      responseStarted = true;
      clearTimeout(startupTimer);
      resetIdleTimer();
      if (!res.write(chunk)) {
        ffmpegProcess.stdout.pause();
        res.once('drain', () => ffmpegProcess.stdout.resume());
      }
    });
    ffmpegProcess.stdout.on('error', () => {
      stopWorker();
      fail(502, 'Transcoding failed', 'TRANSCODE_FAILED');
    });
    ffmpegProcess.on('exit', () => {
      exited = true;
    });
    ffmpegProcess.on('close', () => {
      cleanup();
      if (!responseStarted && !res.writableEnded) {
        fail(502, 'Transcoding failed', 'TRANSCODE_FAILED');
      } else if (!res.writableEnded) res.end();
    });
    // IncomingMessage.close can mean that a GET request has finished arriving.
    // ServerResponse.close is the downstream playback connection lifetime.
    res.on('close', () => {
      stopWorker();
      releaseUsage();
    });
  });
}
