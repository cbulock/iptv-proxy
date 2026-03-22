import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';
import fs from 'fs/promises';
import path from 'path';
import { getDataPath } from '../../libs/paths.js';
import { runHealthCheck } from '../../scripts/check-channel-health.js';

const CHANNELS_FILE = getDataPath('channels.json');
const STATUS_FILE = getDataPath('lineup_status.json');
const LAST_LOG_FILE = getDataPath('lineup_health_last.json');

describe('check-channel-health', () => {
  let originalChannels = null;
  let hadOriginalChannelsFile = false;

  before(async () => {
    // Save any existing channels.json so we can restore it after the suite
    await fs.mkdir(path.dirname(CHANNELS_FILE), { recursive: true });
    try {
      originalChannels = await fs.readFile(CHANNELS_FILE, 'utf8');
      hadOriginalChannelsFile = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  });

  after(async () => {
    nock.cleanAll();
    nock.enableNetConnect();

    if (hadOriginalChannelsFile && originalChannels !== null) {
      await fs.writeFile(CHANNELS_FILE, originalChannels, 'utf8');
    } else {
      try { await fs.unlink(CHANNELS_FILE); } catch (_) { /* ignore */ }
    }
    // Clean up health check output files written during tests
    for (const f of [STATUS_FILE, LAST_LOG_FILE]) {
      try { await fs.unlink(f); } catch (_) { /* ignore */ }
    }
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('checks HDHomeRun channels via device /discover.json, not individual stream URLs', async () => {
    // Both channels belong to the same device; discover.json should be called only once.
    const channels = [
      {
        name: 'CBS',
        tvg_id: '5.1',
        guideNumber: '5.1',
        url: '/stream/HDHomeRun/CBS',
        original_url: 'http://hdhomerun.local:5004/auto/v5.1',
        source: 'HDHomeRun',
        hdhomerun: { deviceID: 'AABBCCDD', baseURL: 'http://hdhomerun.local:5004', model: 'HDTC-2US' },
      },
      {
        name: 'NBC',
        tvg_id: '6.1',
        guideNumber: '6.1',
        url: '/stream/HDHomeRun/NBC',
        original_url: 'http://hdhomerun.local:5004/auto/v6.1',
        source: 'HDHomeRun',
        hdhomerun: { deviceID: 'AABBCCDD', baseURL: 'http://hdhomerun.local:5004', model: 'HDTC-2US' },
      },
    ];

    await fs.writeFile(CHANNELS_FILE, JSON.stringify(channels));

    // Expect exactly one call to the device discover endpoint
    nock('http://hdhomerun.local:5004')
      .get('/discover.json')
      .once()
      .reply(200, { DeviceID: 'AABBCCDD', BaseURL: 'http://hdhomerun.local:5004' });

    // Stream URLs must NOT be called — doing so would start video encoding on the device.
    // Register mocks for them; if they get called they will be consumed and the pending-mocks
    // assertion below will fail.
    nock('http://hdhomerun.local:5004')
      .get('/auto/v5.1')
      .reply(200, 'mpegts-data', { 'Content-Type': 'video/mp2t' });
    nock('http://hdhomerun.local:5004')
      .get('/auto/v6.1')
      .reply(200, 'mpegts-data', { 'Content-Type': 'video/mp2t' });

    const result = await runHealthCheck();

    expect(result['5.1']).to.equal('online');
    expect(result['6.1']).to.equal('online');

    // Both stream mocks should still be pending (never called)
    expect(nock.pendingMocks()).to.have.lengthOf(2);
  });

  it('marks HDHomeRun channels offline when the device is unreachable', async () => {
    const channels = [
      {
        name: 'CBS',
        tvg_id: '5.1',
        guideNumber: '5.1',
        url: '/stream/HDHomeRun/CBS',
        original_url: 'http://offline-device.local:5004/auto/v5.1',
        source: 'HDHomeRun',
        hdhomerun: { deviceID: 'DEADBEEF', baseURL: 'http://offline-device.local:5004', model: 'HDTC-2US' },
      },
    ];

    await fs.writeFile(CHANNELS_FILE, JSON.stringify(channels));

    nock('http://offline-device.local:5004')
      .get('/discover.json')
      .replyWithError('connect ECONNREFUSED');

    const result = await runHealthCheck();
    expect(result['5.1']).to.equal('offline');
  });

  it('uses device discover for HDHomeRun and stream probe for regular channels together', async () => {
    const channels = [
      {
        name: 'CBS',
        tvg_id: '5.1',
        guideNumber: '5.1',
        url: '/stream/HDHomeRun/CBS',
        original_url: 'http://hdhomerun2.local:5004/auto/v5.1',
        source: 'HDHomeRun',
        hdhomerun: { deviceID: 'AABBCCDD', baseURL: 'http://hdhomerun2.local:5004', model: 'HDTC-2US' },
      },
      {
        name: 'Regular Channel',
        tvg_id: 'regular.1',
        url: 'http://m3u-source.example/stream/regular',
        original_url: 'http://m3u-source.example/stream/regular',
        source: 'M3USource',
      },
    ];

    await fs.writeFile(CHANNELS_FILE, JSON.stringify(channels));

    // HDHomeRun: device-level check only
    nock('http://hdhomerun2.local:5004')
      .get('/discover.json')
      .reply(200, { DeviceID: 'AABBCCDD', BaseURL: 'http://hdhomerun2.local:5004' });

    // Regular channel: stream probe (HEAD first)
    nock('http://m3u-source.example')
      .head('/stream/regular')
      .reply(200, '', { 'Content-Type': 'video/mp2t' });

    const result = await runHealthCheck();
    expect(result['5.1']).to.equal('online');
    expect(result['regular.1']).to.equal('online');
  });
});
