import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { getDataPath } from '../../libs/paths.js';
import { initChannelsCache, cleanupCache } from '../../libs/channels-cache.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function startServer(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function stopServer(server) {
  return new Promise(resolve => server.close(resolve));
}

/**
 * Build an XMLTV string with programmes relative to `now` so that the
 * /api/guide endpoint (which filters by the current wall-clock time) always
 * has something to return, regardless of when the tests run.
 */
function buildFutureXMLTV(tvgId) {
  const now = new Date();

  function xmltvDate(d) {
    const pad = n => String(n).padStart(2, '0');
    return (
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
      `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`
    );
  }

  // Programme 1: currently airing (started 30 min ago, ends 30 min from now)
  const p1Start = new Date(now.getTime() - 30 * 60 * 1000);
  const p1Stop = new Date(now.getTime() + 30 * 60 * 1000);

  // Programme 2: upcoming (starts in 1 hour, ends in 2 hours)
  const p2Start = new Date(now.getTime() + 60 * 60 * 1000);
  const p2Stop = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  return `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="${tvgId}">
    <display-name>Guide Test Channel</display-name>
  </channel>
  <channel id="other.channel">
    <display-name>Other Channel</display-name>
  </channel>
  <programme channel="${tvgId}" start="${xmltvDate(p1Start)}" stop="${xmltvDate(p1Stop)}">
    <title>Current Show</title>
    <desc>A show airing right now.</desc>
  </programme>
  <programme channel="${tvgId}" start="${xmltvDate(p2Start)}" stop="${xmltvDate(p2Stop)}">
    <title>Upcoming Show</title>
    <desc>A show starting soon.</desc>
  </programme>
  <programme channel="other.channel" start="${xmltvDate(p1Start)}" stop="${xmltvDate(p1Stop)}">
    <title>Other Show</title>
    <desc>On a different channel.</desc>
  </programme>
</tv>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/guide', () => {
  const TVG_ID = 'guide-test.1';
  let tmpConfigDir;
  let epgFilePath;
  let server;
  let baseUrl;
  const channelsFile = getDataPath('channels.json');
  let originalChannels = null;
  let hadOriginalChannelsFile = false;

  before(async () => {
    // Save existing channels.json if it exists
    try {
      originalChannels = await fs.readFile(channelsFile, 'utf8');
      hadOriginalChannelsFile = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Write test channels
    await fs.mkdir(path.dirname(channelsFile), { recursive: true });
    const testChannels = [
      { name: 'Guide Test Channel', tvg_id: TVG_ID, source: 'GuideProvider' },
      { name: 'Other Channel', tvg_id: 'other.channel', source: 'GuideProvider' },
    ];
    await fs.writeFile(channelsFile, JSON.stringify(testChannels), 'utf8');
    await initChannelsCache();

    // Create temp config dir with a providers.yaml referencing a local EPG file
    tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-guide-test-'));
    epgFilePath = path.join(tmpConfigDir, 'guide-test.xml');
    await fs.writeFile(epgFilePath, buildFutureXMLTV(TVG_ID), 'utf8');
    await fs.writeFile(
      path.join(tmpConfigDir, 'providers.yaml'),
      `providers:\n  - name: GuideProvider\n    url: "http://placeholder"\n    epg: "${pathToFileURL(epgFilePath).href}"\n`,
      'utf8'
    );
    // app.yaml with no admin_auth so requireAuth passes through
    await fs.writeFile(path.join(tmpConfigDir, 'app.yaml'), '{}\n', 'utf8');

    process.env.CONFIG_PATH = tmpConfigDir;

    // Build app and register EPG routes
    const app = express();
    app.use(express.json());

    const { setupEPGRoutes } = await import('../../server/epg.js');
    const { errorHandler } = await import('../../server/error-handler.js');

    await setupEPGRoutes(app);
    app.use(errorHandler);

    ({ server, baseUrl } = await startServer(app));
  });

  after(async () => {
    if (server) await stopServer(server);
    await cleanupCache();
    // Restore original channels.json
    if (hadOriginalChannelsFile) {
      await fs.writeFile(channelsFile, originalChannels, 'utf8');
    } else {
      await fs.unlink(channelsFile).catch(() => {});
    }
    await fs.rm(tmpConfigDir, { recursive: true, force: true });
    delete process.env.CONFIG_PATH;
  });

  it('returns 200 with programmes for a known tvgId', async () => {
    const res = await axios.get(`${baseUrl}/api/guide?tvgId=${TVG_ID}`);
    expect(res.status).to.equal(200);
    expect(res.data).to.have.property('programmes').that.is.an('array');
    expect(res.data.programmes.length).to.be.at.least(1);
    expect(res.data.programmes[0]).to.have.all.keys('title', 'desc', 'start', 'stop', 'channel');
    expect(res.data.programmes[0].channel).to.equal(TVG_ID);
  });

  it('returns both the currently-airing and the upcoming programme', async () => {
    const res = await axios.get(`${baseUrl}/api/guide?tvgId=${TVG_ID}`);
    const titles = res.data.programmes.map(p => p.title);
    expect(titles).to.include('Current Show');
    expect(titles).to.include('Upcoming Show');
  });

  it('programmes are sorted by start time ascending', async () => {
    const res = await axios.get(`${baseUrl}/api/guide?tvgId=${TVG_ID}`);
    const progs = res.data.programmes;
    for (let i = 1; i < progs.length; i++) {
      expect(progs[i - 1].start <= progs[i].start).to.be.true;
    }
  });

  it('filters by tvgId — does not return programmes from other channels', async () => {
    const res = await axios.get(`${baseUrl}/api/guide?tvgId=${TVG_ID}`);
    for (const prog of res.data.programmes) {
      expect(prog.channel).to.equal(TVG_ID);
    }
  });

  it('returns programmes from all channels when tvgId is omitted', async () => {
    const res = await axios.get(`${baseUrl}/api/guide`);
    expect(res.status).to.equal(200);
    const channels = new Set(res.data.programmes.map(p => p.channel));
    expect(channels.size).to.be.at.least(1);
  });

  it('returns 200 with an empty array for an unknown tvgId', async () => {
    const res = await axios.get(`${baseUrl}/api/guide?tvgId=nonexistent.channel`);
    expect(res.status).to.equal(200);
    expect(res.data.programmes).to.be.an('array').with.lengthOf(0);
    expect(res.data.total).to.equal(0);
  });
});
