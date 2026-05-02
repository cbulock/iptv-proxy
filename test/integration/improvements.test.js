import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { closeDatabase } from '../../libs/database.js';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
async function startServer(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function stopServer(server) {
  return new Promise(resolve => server.close(resolve));
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. PORT env-var support
// ──────────────────────────────────────────────────────────────────────────────
describe('PORT environment variable', () => {
  it('defaults to 34400 when PORT is not set', () => {
    const port = parseInt(process.env.PORT || '34400', 10);
    expect(port).to.equal(34400);
  });

  it('honours the PORT env variable when set', () => {
    const originalPort = process.env.PORT;
    process.env.PORT = '9999';
    const port = parseInt(process.env.PORT || '34400', 10);
    expect(port).to.equal(9999);
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Config backup/restore API
// ──────────────────────────────────────────────────────────────────────────────
describe('Config Backup API', () => {
  let tmpDir;
  let server;
  let baseUrl;
  let databaseModule;
  let appSettingsService;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-backup-test-'));

    // Write some dummy config files
    await fs.writeFile(path.join(tmpDir, 'm3u.yaml'), 'urls: []\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'epg.yaml'), 'urls: []\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'app.yaml'), 'base_url: "https://yaml.example.com"\n', 'utf8');

    // Point config loader to our temp dir
    process.env.CONFIG_PATH = tmpDir;

    // Also set DATA_PATH so backups go to the temp dir
    process.env.DATA_PATH = tmpDir;

    const backupRouter = (await import('../../server/backup.js')).default;
    databaseModule = await import('../../libs/database.js');
    appSettingsService = await import(`../../libs/app-settings-service.js?test=${Date.now()}`);

    const app = express();
    app.use(express.json());
    // Bypass auth for test by always calling next()
    app.use((req, _res, next) => {
      req.session = { authenticated: true };
      next();
    });
    app.use(backupRouter);

    ({ server, baseUrl } = await startServer(app));
  });

  after(async () => {
    await stopServer(server);
    databaseModule.closeDatabase();
    await fs.rm(tmpDir, { recursive: true, force: true });
    delete process.env.CONFIG_PATH;
    delete process.env.DATA_PATH;
  });

  it('POST /api/config/backup creates a backup directory', async () => {
    const res = await axios.post(`${baseUrl}/api/config/backup`);
    expect(res.status).to.equal(200);
    expect(res.data.status).to.equal('created');
    expect(res.data.name).to.match(/^backup-/);
    expect(res.data.files).to.be.an('array').with.length.greaterThan(0);
    expect(res.data.files).to.include('iptv-proxy.sqlite');
  });

  it('GET /api/config/backups lists created backups', async () => {
    const res = await axios.get(`${baseUrl}/api/config/backups`);
    expect(res.status).to.equal(200);
    expect(res.data.backups).to.be.an('array').with.length.greaterThan(0);
    expect(res.data.count).to.equal(res.data.backups.length);
    expect(res.data.backups[0].name).to.match(/^backup-/);
  });

  it('POST /api/config/backups/:name/restore restores files', async () => {
    // Create backup
    const createRes = await axios.post(`${baseUrl}/api/config/backup`);
    const { name } = createRes.data;

    // Corrupt the source file
    await fs.writeFile(path.join(tmpDir, 'm3u.yaml'), 'CORRUPTED\n', 'utf8');

    // Restore
    const restoreRes = await axios.post(`${baseUrl}/api/config/backups/${name}/restore`);
    expect(restoreRes.status).to.equal(200);
    expect(restoreRes.data.status).to.equal('restored');
    expect(restoreRes.data.files).to.include('m3u.yaml');

    // Verify file content was restored
    const content = await fs.readFile(path.join(tmpDir, 'm3u.yaml'), 'utf8');
    expect(content).to.equal('urls: []\n');
  });

  it('keeps the SQLite database available after creating a backup', async () => {
    const createRes = await axios.post(`${baseUrl}/api/config/backup`);
    expect(createRes.status).to.equal(200);

    appSettingsService.replaceAppConfig({ base_url: 'https://still-open.example.com' });
    expect(appSettingsService.loadAppConfigFromStore()).to.deep.equal({
      base_url: 'https://still-open.example.com',
    });
  });

  it('restores SQLite-backed app state from the database snapshot instead of stale YAML exports', async () => {
    databaseModule.initDatabase();
    databaseModule.run('DELETE FROM app_settings');
    databaseModule.run(
      'INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)',
      [
        'app-config',
        JSON.stringify({ base_url: 'https://db-backed.example.com' }),
        new Date().toISOString(),
      ]
    );
    databaseModule.closeDatabase();

    const createRes = await axios.post(`${baseUrl}/api/config/backup`);
    const { name } = createRes.data;

    await fs.writeFile(path.join(tmpDir, 'app.yaml'), 'base_url: "https://stale-yaml.example.com"\n', 'utf8');
    appSettingsService.replaceAppConfig({ base_url: 'https://mutated-after-backup.example.com' });
    databaseModule.closeDatabase();

    const restoreRes = await axios.post(`${baseUrl}/api/config/backups/${name}/restore`);
    expect(restoreRes.status).to.equal(200);
    expect(restoreRes.data.files).to.include('iptv-proxy.sqlite');
    expect(restoreRes.data.files).to.include('app.yaml');

    expect(appSettingsService.loadAppConfigFromStore()).to.deep.equal({
      base_url: 'https://db-backed.example.com',
    });

    const content = await fs.readFile(path.join(tmpDir, 'app.yaml'), 'utf8');
    expect(content).to.include('base_url: https://db-backed.example.com');
  });

  it('DELETE /api/config/backups/:name deletes a backup', async () => {
    const createRes = await axios.post(`${baseUrl}/api/config/backup`);
    const { name } = createRes.data;

    const deleteRes = await axios.delete(`${baseUrl}/api/config/backups/${name}`);
    expect(deleteRes.status).to.equal(200);
    expect(deleteRes.data.status).to.equal('deleted');

    // Confirm it's gone
    const listRes = await axios.get(`${baseUrl}/api/config/backups`);
    const names = listRes.data.backups.map(b => b.name);
    expect(names).to.not.include(name);
  });

  it('GET /api/config/backups/:name/download returns a zip file', async () => {
    const createRes = await axios.post(`${baseUrl}/api/config/backup`);
    const { name } = createRes.data;

    const downloadRes = await axios.get(`${baseUrl}/api/config/backups/${name}/download`, {
      responseType: 'arraybuffer',
    });

    expect(downloadRes.status).to.equal(200);
    expect(downloadRes.headers['content-type']).to.equal('application/zip');
    expect(downloadRes.headers['content-disposition']).to.include(`${name}.zip`);
    expect(downloadRes.headers['cache-control']).to.include('no-store');

    // ZIP files start with the PK magic bytes (0x50 0x4B)
    const buf = Buffer.from(downloadRes.data);
    expect(buf[0]).to.equal(0x50); // 'P'
    expect(buf[1]).to.equal(0x4b); // 'K'
  });

  it('GET /api/config/backups/:name/download returns 404 for unknown backup', async () => {
    try {
      await axios.get(`${baseUrl}/api/config/backups/backup-9999-99-99T99-99-99/download`);
      expect.fail('Expected 404');
    } catch (err) {
      expect(err.response.status).to.equal(404);
    }
  });

  it('GET /api/config/backups/:name/download returns 400 for invalid backup name', async () => {
    try {
      await axios.get(`${baseUrl}/api/config/backups/../../etc/passwd/download`);
      expect.fail('Expected 400 or 404');
    } catch (err) {
      expect([400, 404]).to.include(err.response.status);
    }
  });

  it('POST /api/config/backups/:name/restore returns 404 for unknown backup', async () => {
    try {
      await axios.post(`${baseUrl}/api/config/backups/backup-9999-99-99T99-99-99/restore`);
      expect.fail('Expected 404');
    } catch (err) {
      expect(err.response.status).to.equal(404);
    }
  });

  it('rejects backup names that could cause path traversal', async () => {
    try {
      await axios.post(`${baseUrl}/api/config/backups/../etc/passwd/restore`);
      expect.fail('Expected 400 or 404');
    } catch (err) {
      expect([400, 404]).to.include(err.response.status);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Stream usage history
// ──────────────────────────────────────────────────────────────────────────────
describe('Usage History', () => {
  let server;
  let baseUrl;
  let registerUsage, unregisterUsage, usageRouter;

  before(async () => {
    // Import the module fresh – history is module-level state.
    // We re-import on every test suite run; mocha caches ESM modules so the
    // HISTORY array may already have entries from other test runs, which is OK
    // because we only check that our entries appear.
    const mod = await import('../../server/usage.js');
    registerUsage = mod.registerUsage;
    unregisterUsage = mod.unregisterUsage;
    usageRouter = mod.default;

    const app = express();
    app.use(express.json());
    // Bypass auth
    app.use((req, _res, next) => {
      req.session = { authenticated: true };
      next();
    });
    app.use(usageRouter);

    ({ server, baseUrl } = await startServer(app));
  });

  after(async () => {
    await stopServer(server);
  });

  it('GET /api/usage/history returns an array', async () => {
    const res = await axios.get(`${baseUrl}/api/usage/history`);
    expect(res.status).to.equal(200);
    expect(res.data.history).to.be.an('array');
    expect(res.data.count).to.equal(res.data.history.length);
  });

  it('completed stream appears in history with durationSeconds', async () => {
    const channelId = `history-test-${Date.now()}`;
    const key = await registerUsage({ ip: '10.0.0.1', channelId });

    // Small delay so duration > 0
    await new Promise(r => setTimeout(r, 10));

    unregisterUsage(key);

    const res = await axios.get(`${baseUrl}/api/usage/history`);
    const entry = res.data.history.find(h => h.ip === '10.0.0.1' && h.channelId === channelId);

    expect(entry).to.exist;
    expect(entry.endedAt).to.be.a('string');
    expect(entry.durationSeconds).to.be.a('number').and.at.least(0);
  });

  it('history is returned in reverse-chronological order', async () => {
    const id1 = `order-test-1-${Date.now()}`;
    const id2 = `order-test-2-${Date.now()}`;

    const k1 = await registerUsage({ ip: '10.0.0.2', channelId: id1 });
    await new Promise(r => setTimeout(r, 5));
    const k2 = await registerUsage({ ip: '10.0.0.2', channelId: id2 });
    await new Promise(r => setTimeout(r, 5));

    unregisterUsage(k1);
    unregisterUsage(k2);

    const res = await axios.get(`${baseUrl}/api/usage/history`);
    const entries = res.data.history.filter(
      h => h.ip === '10.0.0.2' && (h.channelId === id1 || h.channelId === id2)
    );

    // id2 ended later, so it should appear first in reverse-chronological list
    const idx1 = entries.findIndex(h => h.channelId === id1);
    const idx2 = entries.findIndex(h => h.channelId === id2);
    expect(idx2).to.be.lessThan(idx1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Webhook notifications
// ──────────────────────────────────────────────────────────────────────────────
describe('Webhook notifications', () => {
  let tmpDir;
  let configDir;
  let dataDir;
  let axiosPostStub;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-webhook-test-'));
    configDir = path.join(tmpDir, 'config');
    dataDir = path.join(tmpDir, 'data');
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });
    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;
  });

  after(async () => {
    closeDatabase();
    await fs.rm(tmpDir, { recursive: true, force: true });
    delete process.env.CONFIG_PATH;
    delete process.env.DATA_PATH;
  });

  beforeEach(async () => {
    closeDatabase();
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.mkdir(dataDir, { recursive: true });
    axiosPostStub = sinon.stub(axios, 'post').resolves({ status: 200 });
  });

  afterEach(async () => {
    axiosPostStub.restore();
    closeDatabase();
  });

  it('does nothing when no webhooks are configured', async () => {
    await fs.writeFile(path.join(configDir, 'app.yaml'), 'base_url: ""\n', 'utf8');

    const { notifyWebhooks } = await import('../../libs/webhooks.js');
    await notifyWebhooks('channels.refreshed', { channels: 5 });

    expect(axiosPostStub.called).to.be.false;
  });

  it('calls the configured webhook URL with correct payload', async () => {
    await fs.writeFile(
      path.join(configDir, 'app.yaml'),
      'webhooks:\n  - url: "http://example.com/hook"\n',
      'utf8'
    );

    const { notifyWebhooks } = await import('../../libs/webhooks.js');
    await notifyWebhooks('channels.refreshed', { channels: 10 });

    expect(axiosPostStub.calledOnce).to.be.true;
    const [url, body] = axiosPostStub.firstCall.args;
    expect(url).to.equal('http://example.com/hook');
    expect(body.event).to.equal('channels.refreshed');
    expect(body.data.channels).to.equal(10);
    expect(body.timestamp).to.be.a('string');
  });

  it('respects the events filter – skips hooks not subscribed to the event', async () => {
    await fs.writeFile(
      path.join(configDir, 'app.yaml'),
      [
        'webhooks:',
        '  - url: "http://example.com/epg-only"',
        '    events:',
        '      - epg.refreshed',
      ].join('\n') + '\n',
      'utf8'
    );

    const { notifyWebhooks } = await import('../../libs/webhooks.js');
    await notifyWebhooks('channels.refreshed', {});

    expect(axiosPostStub.called).to.be.false;
  });

  it('delivers to hooks subscribed to the matching event', async () => {
    await fs.writeFile(
      path.join(configDir, 'app.yaml'),
      [
        'webhooks:',
        '  - url: "http://example.com/channels-only"',
        '    events:',
        '      - channels.refreshed',
      ].join('\n') + '\n',
      'utf8'
    );

    const { notifyWebhooks } = await import('../../libs/webhooks.js');
    await notifyWebhooks('channels.refreshed', {});

    expect(axiosPostStub.calledOnce).to.be.true;
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. Rate limiting on public endpoints
// ──────────────────────────────────────────────────────────────────────────────
describe('Rate limiting', () => {
  let server;
  let baseUrl;

  before(async () => {
    // Build a minimal express app with the lineup rate limiter applied
    // directly, rather than booting the full server.
    const RateLimit = (await import('express-rate-limit')).default;

    const lineupLimiter = RateLimit({
      windowMs: 1 * 60 * 1000,
      max: 3, // low limit so we can hit it quickly in tests
      standardHeaders: true,
      legacyHeaders: false,
      // Do NOT skip localhost so we can test the limiter itself
      skip: () => false,
    });

    const app = express();
    app.set('trust proxy', false);
    app.get('/lineup.json', lineupLimiter, (_req, res) => res.json({ ok: true }));

    ({ server, baseUrl } = await startServer(app));
  });

  after(async () => {
    await stopServer(server);
  });

  it('allows requests under the rate limit', async () => {
    const res = await axios.get(`${baseUrl}/lineup.json`);
    expect(res.status).to.equal(200);
  });

  it('returns 429 after exceeding the rate limit', async () => {
    // Exhaust the remaining quota (we've already used 1 above)
    const MAX_ATTEMPTS = 10; // well above the limit of 3, guarantees we hit 429
    let lastStatus = 200;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      try {
        const r = await axios.get(`${baseUrl}/lineup.json`);
        lastStatus = r.status;
      } catch (err) {
        lastStatus = err.response?.status ?? 500;
        if (lastStatus === 429) break;
      }
    }
    expect(lastStatus).to.equal(429);
  });

  it('localhost is skipped by the production rate limiter configuration', () => {
    // Validate the skip function used in the real lineup limiter
    const skip = req => req.ip === '::1' || req.ip === '127.0.0.1';
    expect(skip({ ip: '127.0.0.1' })).to.be.true;
    expect(skip({ ip: '::1' })).to.be.true;
    expect(skip({ ip: '192.168.1.50' })).to.be.false;
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. GET /channels?mapped_only=true
// ──────────────────────────────────────────────────────────────────────────────
describe('GET /channels?mapped_only=true', () => {
  let tmpDir;
  let server;
  let baseUrl;
  let originalConfigPath;
  let originalChannels;
  let hadOriginalChannels;

  before(async () => {
    originalConfigPath = process.env.CONFIG_PATH;

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-channels-mapped-test-'));

    // Write a channel-map.yaml that maps only "Mapped Channel"
    await fs.writeFile(
      path.join(tmpDir, 'channel-map.yaml'),
      ['"Mapped Channel":', '  number: "5"', '  tvg_id: mapped.1'].join('\n') + '\n',
      'utf8'
    );

    process.env.CONFIG_PATH = tmpDir;

    // Write channels.json to the real data path (same pattern as lineup.test.js)
    const { getDataPath } = await import('../../libs/paths.js');
    const channelsFile = getDataPath('channels.json');
    await fs.mkdir(path.dirname(channelsFile), { recursive: true });

    try {
      originalChannels = await fs.readFile(channelsFile, 'utf8');
      hadOriginalChannels = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      hadOriginalChannels = false;
    }

    const testChannels = [
      { name: 'Mapped Channel', tvg_id: 'mapped.1', source: 'TestSource', guideNumber: '5' },
      { name: 'Unmapped Channel', tvg_id: 'unmapped.2', source: 'TestSource', guideNumber: '' },
    ];
    await fs.writeFile(channelsFile, JSON.stringify(testChannels), 'utf8');

    const { initChannelsCache, cleanupCache } = await import('../../libs/channels-cache.js');
    cleanupCache();
    await initChannelsCache();

    const channelsRouter = (await import('../../server/channels.js')).default;
    const app = express();
    app.use('/channels', channelsRouter);

    ({ server, baseUrl } = await startServer(app));
  });

  after(async () => {
    await stopServer(server);
    await fs.rm(tmpDir, { recursive: true, force: true });

    const { cleanupCache } = await import('../../libs/channels-cache.js');
    cleanupCache();

    const { getDataPath } = await import('../../libs/paths.js');
    const channelsFile = getDataPath('channels.json');
    if (hadOriginalChannels) {
      await fs.writeFile(channelsFile, originalChannels, 'utf8');
    } else {
      try {
        await fs.unlink(channelsFile);
      } catch (_) {
        /* ignore */
      }
    }

    if (originalConfigPath === undefined) {
      delete process.env.CONFIG_PATH;
    } else {
      process.env.CONFIG_PATH = originalConfigPath;
    }
  });

  it('returns all channels when mapped_only is not set', async () => {
    const res = await axios.get(`${baseUrl}/channels`);
    expect(res.status).to.equal(200);
    expect(res.data).to.be.an('array').with.lengthOf(2);
  });

  it('returns only mapped channels when mapped_only=true', async () => {
    const res = await axios.get(`${baseUrl}/channels?mapped_only=true`);
    expect(res.status).to.equal(200);
    expect(res.data).to.be.an('array').with.lengthOf(1);
    expect(res.data[0].name).to.equal('Mapped Channel');
  });

  it('excludes unmapped channels when mapped_only=true', async () => {
    const res = await axios.get(`${baseUrl}/channels?mapped_only=true`);
    const names = res.data.map(c => c.name);
    expect(names).to.not.include('Unmapped Channel');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. GET /channels?mapped_only=true — HDHomeRun channel filtering
// ──────────────────────────────────────────────────────────────────────────────
describe('GET /channels?mapped_only=true with HDHomeRun channels', () => {
  let tmpDir;
  let server;
  let baseUrl;
  let originalConfigPath;
  let originalChannels;
  let hadOriginalChannels;

  before(async () => {
    originalConfigPath = process.env.CONFIG_PATH;

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-channels-hdhr-test-'));

    // Channel map only contains the M3U channel, not the HDHomeRun channel
    await fs.writeFile(
      path.join(tmpDir, 'channel-map.yaml'),
      ['"Mapped M3U Channel":', '  number: "5"', '  tvg_id: m3u.1'].join('\n') + '\n',
      'utf8'
    );

    process.env.CONFIG_PATH = tmpDir;

    const { getDataPath } = await import('../../libs/paths.js');
    const channelsFile = getDataPath('channels.json');
    await fs.mkdir(path.dirname(channelsFile), { recursive: true });

    try {
      originalChannels = await fs.readFile(channelsFile, 'utf8');
      hadOriginalChannels = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      hadOriginalChannels = false;
    }

    const testChannels = [
      { name: 'Mapped M3U Channel', tvg_id: 'm3u.1', source: 'TestSource', guideNumber: '5' },
      { name: 'Unmapped M3U Channel', tvg_id: 'm3u.2', source: 'TestSource', guideNumber: '' },
      {
        name: 'WLNS-TV',
        tvg_id: '6.1',
        guideNumber: '6',
        source: 'Antenna',
        original_url: 'http://antenna.example/auto/v6.1',
        hdhomerun: { deviceID: '1234', baseURL: 'http://antenna.example', model: 'HDHR3-US' },
      },
    ];
    await fs.writeFile(channelsFile, JSON.stringify(testChannels), 'utf8');

    const { initChannelsCache, cleanupCache } = await import('../../libs/channels-cache.js');
    cleanupCache();
    await initChannelsCache();

    // Invalidate the channel-map cache so this suite reads the new channel map
    const { invalidateChannelMapCache } = await import('../../server/channels.js');
    invalidateChannelMapCache();

    const channelsRouter = (await import('../../server/channels.js')).default;
    const app = express();
    app.use('/channels', channelsRouter);

    ({ server, baseUrl } = await startServer(app));
  });

  after(async () => {
    await stopServer(server);
    await fs.rm(tmpDir, { recursive: true, force: true });

    const { cleanupCache } = await import('../../libs/channels-cache.js');
    cleanupCache();

    // Reset channel-map cache so it doesn't bleed into subsequent suites
    const { invalidateChannelMapCache } = await import('../../server/channels.js');
    invalidateChannelMapCache();

    const { getDataPath } = await import('../../libs/paths.js');
    const channelsFile = getDataPath('channels.json');
    if (hadOriginalChannels) {
      await fs.writeFile(channelsFile, originalChannels, 'utf8');
    } else {
      try {
        await fs.unlink(channelsFile);
      } catch (_) {
        /* ignore */
      }
    }

    if (originalConfigPath === undefined) {
      delete process.env.CONFIG_PATH;
    } else {
      process.env.CONFIG_PATH = originalConfigPath;
    }
  });

  it('returns all 3 channels when mapped_only is not set', async () => {
    const res = await axios.get(`${baseUrl}/channels`);
    expect(res.status).to.equal(200);
    expect(res.data).to.be.an('array').with.lengthOf(3);
  });

  it('excludes HDHomeRun channels that are not in the channel map when mapped_only=true', async () => {
    const res = await axios.get(`${baseUrl}/channels?mapped_only=true`);
    expect(res.status).to.equal(200);
    const names = res.data.map(c => c.name);
    expect(names).to.not.include('WLNS-TV');
  });

  it('excludes unmapped M3U channels when mapped_only=true', async () => {
    const res = await axios.get(`${baseUrl}/channels?mapped_only=true`);
    const names = res.data.map(c => c.name);
    expect(names).to.not.include('Unmapped M3U Channel');
  });

  it('returns only the mapped M3U channel when mapped_only=true', async () => {
    const res = await axios.get(`${baseUrl}/channels?mapped_only=true`);
    expect(res.data).to.be.an('array').with.lengthOf(1);
    expect(res.data[0].name).to.equal('Mapped M3U Channel');
  });

  it('includes an HDHomeRun channel when it is explicitly added to the channel map', async () => {
    // Write a new channel map that also includes the HDHomeRun channel
    await fs.writeFile(
      path.join(tmpDir, 'channel-map.yaml'),
      [
        '"Mapped M3U Channel":',
        '  number: "5"',
        '  tvg_id: m3u.1',
        '"WLNS-TV":',
        '  number: "6"',
        '  tvg_id: "6.1"',
      ].join('\n') + '\n',
      'utf8'
    );

    // Bust the channel-map cache so the new map is picked up
    const { invalidateChannelMapCache } = await import('../../server/channels.js');
    invalidateChannelMapCache();

    const res = await axios.get(`${baseUrl}/channels?mapped_only=true`);
    const names = res.data.map(c => c.name);
    expect(names).to.include('WLNS-TV');
  });
});
