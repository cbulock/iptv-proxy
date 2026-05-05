import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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

function getToolPayload(msg) {
  expect(msg).to.not.be.null;
  return msg.result.structuredContent || JSON.parse(msg.result.content[0].text);
}

function expectToolSuccess(msg, toolName) {
  const payload = getToolPayload(msg);
  expect(msg.result.isError).to.not.equal(true);
  expect(payload.ok).to.equal(true);
  expect(payload.tool).to.equal(toolName);
  expect(payload.summary).to.be.a('string');
  expect(payload.nextSuggestedTools).to.be.an('array');
  return payload;
}

function expectToolError(msg, toolName) {
  const payload = getToolPayload(msg);
  expect(msg.result.isError).to.equal(true);
  expect(payload.ok).to.equal(false);
  expect(payload.tool).to.equal(toolName);
  expect(payload.error).to.include.keys('code', 'message');
  expect(payload.nextSuggestedTools).to.be.an('array');
  return payload;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MCP Route Integration', () => {
  let server;
  let baseUrl;
  let tmpDataDir;
  let tmpConfigDir;
  let cleanupCache;

  before(async function () {
    this.timeout(30000); // ESM dynamic imports can be slow on Windows
    // Create isolated temp directories before importing any DATA_PATH-dependent modules
    tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-mcp-data-'));
    tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-mcp-config-'));

    process.env.DATA_PATH = tmpDataDir;
    process.env.CONFIG_PATH = tmpConfigDir;

    // Dynamic imports after env vars are set so module-level paths resolve correctly
    const { getDataPath } = await import('../../libs/paths.js');
    const channelsCacheModule = await import('../../libs/channels-cache.js');
    const { initChannelsCache } = channelsCacheModule;
    cleanupCache = channelsCacheModule.cleanupCache;
    const { setupMCPRoutes } = await import('../../server/mcp.js');
    const { _resetMergedEPGForTesting } = await import('../../server/epg.js');

    // Ensure EPG is in a clean state regardless of test run order
    _resetMergedEPGForTesting();

    // Write test channels to the isolated temp data dir
    const channelsFile = getDataPath('channels.json');
    await fs.mkdir(path.dirname(channelsFile), { recursive: true });
    const testChannels = [
      { name: 'CNN', tvg_id: 'cnn.us', source: 'TestProvider', group: 'News' },
      { name: 'ESPN', tvg_id: 'espn.us', source: 'TestProvider', group: 'Sports' },
      {
        name: 'Fox News',
        tvg_id: 'fox.us',
        source: 'OtherProvider',
        group: 'News',
        logo: 'http://example.com/fox.png',
      },
    ];
    await fs.writeFile(channelsFile, JSON.stringify(testChannels));
    await initChannelsCache();

    // Minimal config directory (no admin_auth so requireAuth passes through)
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

    const app = express();
    app.use(express.json());
    setupMCPRoutes(app);

    ({ server, baseUrl } = await startServer(app));
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (cleanupCache) cleanupCache();
    const { closeDatabase } = await import('../../libs/database.js');
    closeDatabase();

    await fs.rm(tmpDataDir, { recursive: true, force: true });
    await fs.rm(tmpConfigDir, { recursive: true, force: true });
    delete process.env.DATA_PATH;
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
      'get_agent_workflow',
      'diagnose_agent_readiness',
      'list_channels',
      'get_guide',
      'list_providers',
      'list_canonical_channels',
      'list_channel_bindings',
      'list_guide_bindings',
      'list_output_profiles',
      'create_output_profile',
      'update_output_profile',
      'delete_output_profile',
      'get_output_profile_channels',
      'list_output_profile_entries',
      'set_canonical_channel_published',
      'set_canonical_channel_preferred_stream',
      'set_canonical_channel_guide_binding',
      'update_output_profile_channels',
      'get_status',
      'reload_channels',
      'reload_epg',
    ]);
  });

  it('get_agent_workflow returns workflow guidance for agents', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'get_agent_workflow',
      arguments: {},
    });
    const payload = expectToolSuccess(msg, 'get_agent_workflow');
    expect(payload.data).to.have.property('recommendedEntryTool', 'diagnose_agent_readiness');
    expect(payload.data.phases).to.be.an('array').that.is.not.empty;
    expect(payload.data.toolGroups.overview).to.include('get_status');
  });

  it('diagnose_agent_readiness returns a readiness summary', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'diagnose_agent_readiness',
      arguments: {},
    });
    const payload = expectToolSuccess(msg, 'diagnose_agent_readiness');
    expect(payload.data.counts).to.include({
      providers: 2,
      discoveredChannels: 3,
    });
    expect(payload.data.profileSummaries).to.be.an('array');
    expect(payload.data.issues).to.be.an('array');
  });

  // ── list_channels ──────────────────────────────────────────────────────────

  it('list_channels returns all channels without filters', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_channels',
      arguments: {},
    });
    const payload = expectToolSuccess(msg, 'list_channels');
    const channels = payload.data;
    expect(channels).to.have.lengthOf(3);
    expect(channels[0]).to.have.all.keys(
      'name',
      'source',
      'tvg_id',
      'guideNumber',
      'group',
      'logo'
    );
  });

  it('list_channels filters by source', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_channels',
      arguments: { source: 'TestProvider' },
    });
    const channels = expectToolSuccess(msg, 'list_channels').data;
    expect(channels).to.have.lengthOf(2);
    expect(channels.every(c => c.source === 'TestProvider')).to.be.true;
  });

  it('list_channels filters by name search', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_channels',
      arguments: { search: 'fox' },
    });
    const channels = expectToolSuccess(msg, 'list_channels').data;
    expect(channels).to.have.lengthOf(1);
    expect(channels[0].name).to.equal('Fox News');
  });

  it('list_channels respects the limit parameter', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_channels',
      arguments: { limit: 2 },
    });
    const channels = expectToolSuccess(msg, 'list_channels').data;
    expect(channels).to.have.lengthOf(2);
  });

  // ── list_providers ─────────────────────────────────────────────────────────

  it('list_providers returns configured providers', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_providers',
      arguments: {},
    });
    const providers = expectToolSuccess(msg, 'list_providers').data;
    expect(providers).to.have.lengthOf(2);
    expect(providers[0]).to.have.all.keys('name', 'type', 'hasEpg');
    expect(providers.map(p => p.name)).to.include.members(['TestProvider', 'OtherProvider']);
  });

  it('list_canonical_channels returns canonical channel rows', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_canonical_channels',
      arguments: {},
    });
    const channels = expectToolSuccess(msg, 'list_canonical_channels').data;
    expect(channels).to.be.an('array');
  });

  it('list_channel_bindings returns binding rows', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_channel_bindings',
      arguments: {},
    });
    const bindings = expectToolSuccess(msg, 'list_channel_bindings').data;
    expect(bindings).to.be.an('array');
  });

  it('list_guide_bindings returns guide binding rows', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_guide_bindings',
      arguments: {},
    });
    const bindings = expectToolSuccess(msg, 'list_guide_bindings').data;
    expect(bindings).to.be.an('array');
  });

  it('list_output_profiles returns output profiles', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_output_profiles',
      arguments: {},
    });
    const profiles = expectToolSuccess(msg, 'list_output_profiles').data;
    expect(profiles).to.be.an('array');
  });

  it('create_output_profile, update_output_profile, and delete_output_profile manage named profiles', async () => {
    const createResult = await mcpPost(baseUrl, 'tools/call', {
      name: 'create_output_profile',
      arguments: { name: 'Bedroom TV', enabled: false },
    });
    const createdProfile = expectToolSuccess(
      createResult.msg,
      'create_output_profile'
    ).data;
    expect(createdProfile).to.include({
      name: 'Bedroom TV',
      slug: 'bedroom-tv',
      enabled: false,
    });

    const updateResult = await mcpPost(baseUrl, 'tools/call', {
      name: 'update_output_profile',
      arguments: { slug: 'bedroom-tv', name: 'Bedroom TV Night', enabled: true },
    });
    const updatedProfile = expectToolSuccess(
      updateResult.msg,
      'update_output_profile'
    ).data;
    expect(updatedProfile).to.include({
      name: 'Bedroom TV Night',
      slug: 'bedroom-tv',
      enabled: true,
    });

    const deleteResult = await mcpPost(baseUrl, 'tools/call', {
      name: 'delete_output_profile',
      arguments: { slug: 'bedroom-tv' },
    });
    const deletedProfile = expectToolSuccess(
      deleteResult.msg,
      'delete_output_profile'
    ).data;
    expect(deletedProfile).to.deep.equal({ deleted: true, slug: 'bedroom-tv' });
  });

  it('get_output_profile_channels returns channels for the default profile', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'get_output_profile_channels',
      arguments: { slug: 'default' },
    });
    const channels = expectToolSuccess(msg, 'get_output_profile_channels').data;
    expect(channels).to.be.an('array');
  });

  it('list_output_profile_entries returns output profile entry rows', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'list_output_profile_entries',
      arguments: { slug: 'default' },
    });
    const channels = expectToolSuccess(msg, 'list_output_profile_entries').data;
    expect(channels).to.be.an('array');
  });

  it('set_canonical_channel_published returns an error for an unknown channel', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'set_canonical_channel_published',
      arguments: { id: 'missing-canonical-channel', published: false },
    });
    const payload = expectToolError(msg, 'set_canonical_channel_published');
    expect(payload.error.message).to.include('Canonical channel not found');
  });

  it('set_canonical_channel_preferred_stream returns an error for an unknown channel', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'set_canonical_channel_preferred_stream',
      arguments: {
        canonical_id: 'missing-canonical-channel',
        source_channel_id: 'missing-source-channel',
      },
    });
    const payload = expectToolError(msg, 'set_canonical_channel_preferred_stream');
    expect(payload.error.message).to.include('Canonical channel not found');
  });

  it('set_canonical_channel_guide_binding returns an error for an unknown channel', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'set_canonical_channel_guide_binding',
      arguments: {
        canonical_id: 'missing-canonical-channel',
        source_id: 'missing-source',
        epg_channel_id: 'missing-epg',
      },
    });
    const payload = expectToolError(msg, 'set_canonical_channel_guide_binding');
    expect(payload.error.message).to.include('Canonical channel not found');
  });

  it('update_output_profile_channels returns an error for an unknown profile', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'update_output_profile_channels',
      arguments: {
        slug: 'missing-profile',
        channels: [],
      },
    });
    const payload = expectToolError(msg, 'update_output_profile_channels');
    expect(payload.error.message).to.include('Output profile not found');
  });

  // ── get_status ─────────────────────────────────────────────────────────────

  it('get_status returns channel count and source info', async () => {
    const { msg } = await mcpPost(baseUrl, 'tools/call', {
      name: 'get_status',
      arguments: {},
    });
    const status = expectToolSuccess(msg, 'get_status').data;
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
    const payload = expectToolError(msg, 'get_guide');
    expect(payload.error.message).to.include('EPG data is not available');
  });
});
