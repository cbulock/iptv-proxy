import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getDataPath } from '../../libs/paths.js';
import { initChannelsCache, cleanupCache } from '../../libs/channels-cache.js';
import { setupMCPRoutes } from '../../server/mcp.js';
import { _resetMergedEPGForTesting } from '../../server/epg.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse SSE-formatted text and return an array of JSON-RPC message objects. */
function parseSSE(text) {
  const results = [];
  for (const line of String(text).split('\n')) {
    if (line.startsWith('data: ')) {
      try {
        results.push(JSON.parse(line.slice(6)));
      } catch (_) {
        // skip malformed lines
      }
    }
  }
  return results;
}

/**
 * POST a single JSON-RPC message to the MCP endpoint and return the matching
 * response (matched by id). Returns null when no response is found.
 */
async function mcpPost(baseUrl, method, params = {}, id = 1) {
  const res = await axios.post(
    `${baseUrl}/mcp`,
    { jsonrpc: '2.0', id, method, params },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      responseType: 'text',
      validateStatus: () => true,
    }
  );
  const events = parseSSE(res.data);
  return { status: res.status, msg: events.find(e => e.id === id) || null };
}

function startServer(app) {
  return new Promise(resolve => {
    const srv = app.listen(0, '127.0.0.1', () =>
      resolve({ server: srv, baseUrl: `http://127.0.0.1:${srv.address().port}` })
    );
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MCP Route Integration', () => {
  let server;
  let baseUrl;
  let tmpConfigDir;
  const channelsFile = getDataPath('channels.json');
  let originalChannels = null;
  let hadOriginalChannelsFile = false;

  before(async () => {
    // Ensure EPG is in a clean state regardless of test run order
    _resetMergedEPGForTesting();

    // Persist any existing channels.json so we can restore it afterwards
    try {
      originalChannels = await fs.readFile(channelsFile, 'utf8');
      hadOriginalChannelsFile = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Write test channels
    await fs.mkdir(path.dirname(channelsFile), { recursive: true });
    const testChannels = [
      { name: 'CNN', tvg_id: 'cnn.us', source: 'TestProvider', group: 'News' },
      { name: 'ESPN', tvg_id: 'espn.us', source: 'TestProvider', group: 'Sports' },
      { name: 'Fox News', tvg_id: 'fox.us', source: 'OtherProvider', group: 'News', logo: 'http://example.com/fox.png' },
    ];
    await fs.writeFile(channelsFile, JSON.stringify(testChannels));
    await initChannelsCache();

    // Minimal config directory (no admin_auth so requireAuth passes through)
    tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-mcp-test-'));
    await fs.writeFile(
      path.join(tmpConfigDir, 'providers.yaml'),
      [
        'providers:',
        '  - name: TestProvider',
        '    url: "http://placeholder.example/playlist.m3u"',
        '  - name: OtherProvider',
        '    url: "http://other.example/playlist.m3u"',
      ].join('\n')
    );
    await fs.writeFile(path.join(tmpConfigDir, 'app.yaml'), '{}\n');
    process.env.CONFIG_PATH = tmpConfigDir;

    const app = express();
    app.use(express.json());
    setupMCPRoutes(app);

    ({ server, baseUrl } = await startServer(app));
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    cleanupCache();

    if (hadOriginalChannelsFile && originalChannels !== null) {
      await fs.writeFile(channelsFile, originalChannels);
    } else {
      await fs.unlink(channelsFile).catch(() => {});
    }

    await fs.rm(tmpConfigDir, { recursive: true, force: true });
    delete process.env.CONFIG_PATH;
  });

  // ── GET returns 405 ────────────────────────────────────────────────────────

  it('GET /mcp returns 405 Method Not Allowed', async () => {
    const res = await axios.get(`${baseUrl}/mcp`, { validateStatus: () => true });
    expect(res.status).to.equal(405);
    expect(res.data.error.message).to.include('Method not allowed');
  });

  // ── tools/list ─────────────────────────────────────────────────────────────

  it('tools/list returns all registered tools', async () => {
    const { status, msg } = await mcpPost(baseUrl, 'tools/list');
    expect(status).to.equal(200);
    expect(msg).to.not.be.null;
    const tools = msg.result.tools;
    const names = tools.map(t => t.name);
    expect(names).to.include.members([
      'list_channels',
      'get_guide',
      'list_providers',
      'get_status',
      'reload_channels',
      'reload_epg',
    ]);
  });

  // ── list_channels ──────────────────────────────────────────────────────────

  it('list_channels returns all channels without filters', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_channels',
      arguments: {},
    });
    expect(msg).to.not.be.null;
    const channels = JSON.parse(msg.result.content[0].text);
    expect(channels).to.have.lengthOf(3);
    // Verify the public channel shape exposed by the MCP tool
    expect(channels[0]).to.have.all.keys('name', 'source', 'tvg_id', 'guideNumber', 'group', 'logo');
  });

  it('list_channels filters by source', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_channels',
      arguments: { source: 'TestProvider' },
    });
    const channels = JSON.parse(msg.result.content[0].text);
    expect(channels).to.have.lengthOf(2);
    expect(channels.every(c => c.source === 'TestProvider')).to.be.true;
  });

  it('list_channels filters by name search', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_channels',
      arguments: { search: 'fox' },
    });
    const channels = JSON.parse(msg.result.content[0].text);
    expect(channels).to.have.lengthOf(1);
    expect(channels[0].name).to.equal('Fox News');
  });

  it('list_channels respects the limit parameter', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_channels',
      arguments: { limit: 2 },
    });
    const channels = JSON.parse(msg.result.content[0].text);
    expect(channels).to.have.lengthOf(2);
  });

  // ── list_providers ─────────────────────────────────────────────────────────

  it('list_providers returns configured providers', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_providers',
      arguments: {},
    });
    expect(msg).to.not.be.null;
    const providers = JSON.parse(msg.result.content[0].text);
    expect(providers).to.have.lengthOf(2);
    expect(providers[0]).to.have.all.keys('name', 'type', 'hasEpg');
    expect(providers.map(p => p.name)).to.include.members(['TestProvider', 'OtherProvider']);
  });

  // ── get_status ─────────────────────────────────────────────────────────────

  it('get_status returns channel count and source info', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'get_status',
      arguments: {},
    });
    expect(msg).to.not.be.null;
    const status = JSON.parse(msg.result.content[0].text);
    expect(status).to.have.property('totalChannels', 3);
    expect(status).to.have.property('sources').that.is.an('object');
    expect(status).to.have.property('recentErrors').that.is.an('array');
  });

  // ── get_guide (EPG not loaded) ─────────────────────────────────────────────

  it('get_guide returns an error message when EPG is not loaded', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'get_guide',
      arguments: { tvg_id: 'cnn.us' },
    });
    expect(msg).to.not.be.null;
    expect(msg.result.isError).to.be.true;
    expect(msg.result.content[0].text).to.include('EPG data is not available');
  });
});
