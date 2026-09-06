import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { initChannelsCache, cleanupCache } from '../../libs/channels-cache.js';
import { loadChannelSnapshot, replaceChannelSnapshot } from '../../libs/channel-snapshot-service.js';
import { setupTranscodeRoutes } from '../../server/transcode.js';
import { errorHandler } from '../../server/error-handler.js';

/**
 * Configure the current Node executable as a direct ffmpeg fixture. This is
 * deliberately not a .cmd/.bat wrapper: on Windows those wrappers require
 * cmd.exe, which would undermine the route's no-shell spawning guarantee.
 */
async function makeFFmpegStub(tmpDir, options = {}) {
  const preloadPath = path.join(tmpDir, 'ffmpeg-stub.cjs');
  const preload = `
const fs = require('fs');
const config = JSON.parse(process.env.FFMPEG_STUB_CONFIG);
if (config.argsFile) fs.writeFileSync(config.argsFile, JSON.stringify(process.argv.slice(2)));
if (config.stderrData) process.stderr.write(config.stderrData);
if (config.stdoutData) process.stdout.write(config.stdoutData);
if (config.delayMs) setTimeout(() => process.exit(config.exitCode), config.delayMs);
else process.exit(config.exitCode);
`;
  await fs.writeFile(preloadPath, preload, 'utf8');
  return { preloadPath, options: { exitCode: 0, ...options } };
}

function setProcessPath(value) {
  process.env.PATH = value;
  process.env.Path = value;
}

function setFfmpegStub(stub, originalNodeOptions) {
  process.env.FFMPEG_PATH = process.execPath;
  process.env.FFMPEG_STUB_CONFIG = JSON.stringify(stub.options);
  process.env.NODE_OPTIONS = `${originalNodeOptions || ''} --require ${JSON.stringify(stub.preloadPath)}`.trim();
}

describe('Transcode Route Integration', () => {
  let originalChannels = null;
  let server = null;
  let baseUrl = '';
  let tmpBinDir = null;
  let originalPath = '';
  let originalFfmpegPath;
  let originalNodeOptions;
  let originalStubConfig;

  before(async () => {
    originalChannels = loadChannelSnapshot();

    const testChannels = [
      {
        name: 'OTA Channel',
        tvg_id: 'ota.1',
        source: 'Antenna',
        original_url: 'http://hdhomerun.local/auto/v6.1',
        hdhomerun: { deviceID: 'AABB1122' },
      },
    ];

    replaceChannelSnapshot(testChannels);
    await initChannelsCache();

    // Create a temporary directory for fake ffmpeg binaries
    tmpBinDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcode-test-'));
    originalPath = process.env.Path || process.env.PATH || '';
    originalFfmpegPath = process.env.FFMPEG_PATH;
    originalNodeOptions = process.env.NODE_OPTIONS;
    originalStubConfig = process.env.FFMPEG_STUB_CONFIG;

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
    if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = originalFfmpegPath;
    if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = originalNodeOptions;
    if (originalStubConfig === undefined) delete process.env.FFMPEG_STUB_CONFIG;
    else process.env.FFMPEG_STUB_CONFIG = originalStubConfig;

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    cleanupCache();

    replaceChannelSnapshot(originalChannels || []);

    if (tmpBinDir) {
      await fs.rm(tmpBinDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    // Restore PATH to its original value
    setProcessPath(originalPath);
    if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = originalFfmpegPath;
    if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = originalNodeOptions;
    if (originalStubConfig === undefined) delete process.env.FFMPEG_STUB_CONFIG;
    else process.env.FFMPEG_STUB_CONFIG = originalStubConfig;
  });

  it('returns 404 for an unknown channel', async () => {
    const response = await axios.get(`${baseUrl}/transcode/NoSource/NoChannel`, {
      validateStatus: () => true,
    });
    expect(response.status).to.equal(404);
  });

  it('returns 503 when ffmpeg is not installed (ENOENT)', async () => {
    // An explicit missing binary guarantees ENOENT without relying on PATH or
    // a Windows command-wrapper fixture.
    process.env.FFMPEG_PATH = path.join(tmpBinDir, 'missing-ffmpeg-binary');

    const response = await axios.get(`${baseUrl}/transcode/Antenna/OTA%20Channel`, {
      validateStatus: () => true,
    });

    expect(response.status).to.equal(503);
    expect(response.data).to.have.property('error');
    expect(response.data.error).to.include('ffmpeg');
  });

  it('returns 502 when ffmpeg exits non-zero before writing any output', async () => {
    // Place a stub that exits immediately with code 1 (no stdout)
    const stub = await makeFFmpegStub(tmpBinDir, { exitCode: 1 });
    setFfmpegStub(stub, originalNodeOptions);

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
    const stub = await makeFFmpegStub(tmpBinDir, { exitCode: 0, stdoutData: 'FAKEDATA' });
    setFfmpegStub(stub, originalNodeOptions);

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
    const stub = await makeFFmpegStub(tmpBinDir, { exitCode: 0, stdoutData: 'X', argsFile });
    setFfmpegStub(stub, originalNodeOptions);

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
