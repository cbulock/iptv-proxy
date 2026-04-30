import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getDataPath } from '../../libs/paths.js';
import { initChannelsCache, cleanupCache } from '../../libs/channels-cache.js';
import { setupTranscodeRoutes } from '../../server/transcode.js';
import { errorHandler } from '../../server/error-handler.js';

/**
 * Create a minimal Node.js script that exits with the given code and optionally
 * writes bytes to stdout first. Using Node.js avoids any shell-escaping concerns
 * with the stdout data. Returns the path to the script.
 */
async function makeFFmpegStub(tmpDir, { exitCode = 0, stdoutData = null, argsFile = null } = {}) {
  let script = '#!/usr/bin/env node\n';
  if (argsFile !== null) {
    // The stub runs in a temp dir with no package.json, so Node.js treats it as
    // CommonJS.  Using require() here is intentional and correct for that context.
    script += 'const _fs = require(\'fs\');\n';
    script += `_fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\n`;
  }
  if (stdoutData !== null) {
    script += `process.stdout.write(${JSON.stringify(stdoutData)});\n`;
  }
  script += `process.exit(${exitCode});\n`;

  if (process.platform === 'win32') {
    const scriptPath = path.join(tmpDir, 'ffmpeg-stub.cjs');
    const bin = path.join(tmpDir, 'ffmpeg.cmd');
    await fs.writeFile(scriptPath, script, 'utf8');
    await fs.writeFile(bin, '@echo off\r\nnode "%~dp0\\ffmpeg-stub.cjs" %*\r\n', 'utf8');
    return bin;
  }

  const bin = path.join(tmpDir, 'ffmpeg');
  await fs.writeFile(bin, script, { mode: 0o755 });
  return bin;
}

function setProcessPath(value) {
  process.env.PATH = value;
  process.env.Path = value;
}

describe('Transcode Route Integration', () => {
  const channelsFile = getDataPath('channels.json');
  let originalChannels = null;
  let hadOriginalChannelsFile = false;
  let server = null;
  let baseUrl = '';
  let tmpBinDir = null;
  let originalPath = '';

  before(async () => {
    // Preserve original channels file
    await fs.mkdir(path.dirname(channelsFile), { recursive: true });
    try {
      originalChannels = await fs.readFile(channelsFile, 'utf8');
      hadOriginalChannelsFile = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const testChannels = [
      {
        name: 'OTA Channel',
        tvg_id: 'ota.1',
        source: 'Antenna',
        original_url: 'http://hdhomerun.local/auto/v6.1',
        hdhomerun: { deviceID: 'AABB1122' },
      },
    ];

    await fs.writeFile(channelsFile, JSON.stringify(testChannels), 'utf8');
    await initChannelsCache();

    // Create a temporary directory for fake ffmpeg binaries
    tmpBinDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcode-test-'));
    originalPath = process.env.Path || process.env.PATH || '';

    const app = express();
    setupTranscodeRoutes(app);
    app.use(errorHandler);

    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    // Restore PATH
    setProcessPath(originalPath);

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    cleanupCache();

    if (hadOriginalChannelsFile && originalChannels !== null) {
      await fs.writeFile(channelsFile, originalChannels, 'utf8');
    } else {
      try {
        await fs.unlink(channelsFile);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    if (tmpBinDir) {
      await fs.rm(tmpBinDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    // Remove any ffmpeg stub placed in tmpBinDir between tests
    try {
      await fs.unlink(path.join(tmpBinDir, 'ffmpeg'));
    } catch (_) {
      // not present — that's fine
    }
    try {
      await fs.unlink(path.join(tmpBinDir, 'ffmpeg.cmd'));
    } catch (_) {
      // not present — that's fine
    }
    try {
      await fs.unlink(path.join(tmpBinDir, 'ffmpeg-stub.cjs'));
    } catch (_) {
      // not present — that's fine
    }
    // Restore PATH to its original value
    setProcessPath(originalPath);
  });

  it('returns 404 for an unknown channel', async () => {
    const response = await axios.get(`${baseUrl}/transcode/NoSource/NoChannel`, {
      validateStatus: () => true,
    });
    expect(response.status).to.equal(404);
  });

  it('returns 503 when ffmpeg is not installed (ENOENT)', async () => {
    // Remove tmpBinDir from PATH so that the real ffmpeg (if present) cannot be used
    // and the stub is also absent, guaranteeing an ENOENT spawn error.
    setProcessPath('/nonexistent-path-for-test');

    const response = await axios.get(`${baseUrl}/transcode/Antenna/OTA%20Channel`, {
      validateStatus: () => true,
    });

    expect(response.status).to.equal(503);
    expect(response.data).to.have.property('error');
    expect(response.data.error).to.include('ffmpeg');
  });

  it('returns 502 when ffmpeg exits non-zero before writing any output', async () => {
    // Place a stub that exits immediately with code 1 (no stdout)
    await makeFFmpegStub(tmpBinDir, { exitCode: 1 });
    setProcessPath(`${tmpBinDir}${path.delimiter}${originalPath}`);

    const response = await axios.get(`${baseUrl}/transcode/Antenna/OTA%20Channel`, {
      validateStatus: () => true,
    });

    expect(response.status).to.equal(502);
    expect(response.data).to.have.property('error');
    expect(response.data.error).to.include('Transcoding failed');
    expect(response.data).to.have.property('details');
    expect(response.data.details).to.include('1');
  });

  it('pipes ffmpeg stdout to the response', async () => {
    // Place a stub that writes known bytes to stdout and exits cleanly
    await makeFFmpegStub(tmpBinDir, { exitCode: 0, stdoutData: 'FAKEDATA' });
    setProcessPath(`${tmpBinDir}${path.delimiter}${originalPath}`);

    const response = await axios.get(`${baseUrl}/transcode/Antenna/OTA%20Channel`, {
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });

    expect(response.status).to.equal(200);
    expect(response.headers['content-type']).to.match(/video\/mp2t/i);
    expect(Buffer.from(response.data).toString()).to.equal('FAKEDATA');
  });

  it('passes browser-compatible encoding flags to ffmpeg', async () => {
    const argsFile = path.join(tmpBinDir, 'ffmpeg-args.json');
    await makeFFmpegStub(tmpBinDir, { exitCode: 0, stdoutData: 'X', argsFile });
    setProcessPath(`${tmpBinDir}${path.delimiter}${originalPath}`);

    await axios.get(`${baseUrl}/transcode/Antenna/OTA%20Channel`, {
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });

    const args = JSON.parse(await fs.readFile(argsFile, 'utf8'));

    // Stereo downmix (-ac 2) must be present so 5.1 AC-3 is not re-encoded as
    // 6-channel AAC, which many browser MSE implementations reject.
    expect(args).to.include('-ac');
    expect(args[args.indexOf('-ac') + 1]).to.equal('2');

    // Explicit audio bitrate (-b:a 128k) for consistent, broadly-supported output.
    expect(args).to.include('-b:a');
    expect(args[args.indexOf('-b:a') + 1]).to.equal('128k');

    // yuv420p pixel format required by browser MSE H.264 decoders.
    expect(args).to.include('-pix_fmt');
    expect(args[args.indexOf('-pix_fmt') + 1]).to.equal('yuv420p');

    // libx264 encoder must still be used.
    expect(args).to.include('libx264');

    // Output must be MPEG-TS piped to stdout.
    expect(args).to.include('mpegts');
    expect(args[args.length - 1]).to.equal('pipe:1');
  });
});
