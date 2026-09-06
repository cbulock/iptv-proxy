import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import nock from 'nock';

function parseSSE(text) {
  return String(text)
    .split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
}

async function callMcpTool(baseUrl, name, args, id = 1) {
  const response = await axios.post(
    `${baseUrl}/mcp`,
    {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    {
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      responseType: 'text',
    }
  );
  return parseSSE(response.data).find(message => message.id === id);
}

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

describe('output profile routes', () => {
  let configDir;
  let dataDir;
  let server;
  let baseUrl;
  let parseM3UModule;
  let databaseModule;
  let epgOnePath;
  let epgTwoPath;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-output-routes-config-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-output-routes-data-'));

    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;

    epgOnePath = path.join(configDir, 'one.xml');
    epgTwoPath = path.join(configDir, 'two.xml');
    await fs.writeFile(
      epgOnePath,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv>',
        '  <channel id="output.1"><display-name>Canonical One</display-name></channel>',
        '  <programme channel="output.1" start="20240101000000 +0000" stop="20240101010000 +0000">',
        '    <title>Channel One Show</title>',
        '  </programme>',
        '</tv>',
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      epgTwoPath,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv>',
        '  <channel id="output.2"><display-name>Canonical Two</display-name></channel>',
        '  <programme channel="output.2" start="20240101000000 +0000" stop="20240101010000 +0000">',
        '    <title>Channel Two Show</title>',
        '  </programme>',
        '</tv>',
      ].join('\n'),
      'utf8'
    );

    await fs.writeFile(
      path.join(configDir, 'providers.yaml'),
      [
        'providers:',
        '  - name: IPTV One',
        '    url: "http://output-routes.example/one.m3u"',
        `    epg: "${pathToFileURL(epgOnePath).href}"`,
        '    type: "m3u"',
        '  - name: IPTV Two',
        '    url: "http://output-routes.example/two.m3u"',
        `    epg: "${pathToFileURL(epgTwoPath).href}"`,
        '    type: "m3u"',
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(configDir, 'channel-map.yaml'),
      [
        "'Source One':",
        "  name: 'Canonical One'",
        "  tvg_id: 'output.1'",
        "  number: '201'",
        "'Source Two':",
        "  name: 'Canonical Two'",
        "  tvg_id: 'output.2'",
        "  number: '202'",
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(path.join(configDir, 'app.yaml'), '{}\n', 'utf8');

    nock('http://output-routes.example')
      .get('/one.m3u')
      .reply(
        200,
        [
          '#EXTM3U',
          '#EXTINF:-1 tvg-id="raw.one" tvg-logo="http://logos.example/one.png",Source One',
          'http://streams.example/one',
        ].join('\n')
      );
    nock('http://output-routes.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    parseM3UModule = await import(`../../scripts/parseM3U.js?test=${Date.now()}`);
    databaseModule = await import('../../libs/database.js');
    await parseM3UModule.parseAll();
    const { initChannelsCache } = await import('../../libs/channels-cache.js');
    await initChannelsCache();

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { authenticated: true };
      next();
    });

    const lineupModule = await import(`../../server/lineup.js?test=${Date.now()}`);
    const epgModule = await import(`../../server/epg.js?test=${Date.now()}`);
    const errorHandlerModule = await import(`../../server/error-handler.js?test=${Date.now()}`);
    const canonicalRouter = (await import(`../../server/canonical.js?test=${Date.now()}`)).default;
    const { setupMCPRoutes } = await import(`../../server/mcp.js?test=${Date.now()}`);
    lineupModule.setupLineupRoutes(app, {});
    await epgModule.setupEPGRoutes(app);
    app.use(canonicalRouter);
    setupMCPRoutes(app);
    app.use(errorHandlerModule.errorHandler);

    ({ server, baseUrl } = await startServer(app));
  });

  afterEach(async () => {
    if (server) {
      await stopServer(server);
    }
    nock.cleanAll();
    databaseModule.closeDatabase();
    delete process.env.CONFIG_PATH;
    delete process.env.DATA_PATH;
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('lists output profile entries and applies updates that persist across reloads', async () => {
    const entriesResponse = await axios.get(`${baseUrl}/api/output-profiles/default/entries`);
    expect(entriesResponse.data.channels).to.have.lengthOf(2);

    const [first, second] = entriesResponse.data.channels;
    const updateResponse = await axios.patch(`${baseUrl}/api/output-profiles/default/channels`, {
      channels: [
        {
          canonicalId: first.canonical.id,
          position: 1,
          enabled: false,
          guideNumberOverride: null,
        },
        {
          canonicalId: second.canonical.id,
          position: 0,
          enabled: true,
          guideNumberOverride: '900',
        },
      ],
    });

    expect(updateResponse.data).to.include({ status: 'saved' });
    expect(updateResponse.data.channels.find(entry => entry.canonical.id === first.canonical.id)).to.include({
      position: 1,
      enabled: false,
    });
    expect(updateResponse.data.channels.find(entry => entry.canonical.id === second.canonical.id)).to.include({
      position: 0,
      enabled: true,
      guideNumberOverride: '900',
    });

    const publishedResponse = await axios.get(`${baseUrl}/api/output-profiles/default/channels`);
    expect(publishedResponse.data.channels).to.have.lengthOf(1);
    expect(publishedResponse.data.channels[0]).to.include({
      name: 'Canonical Two',
      guideNumber: '900',
      position: 0,
    });

    nock('http://output-routes.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://output-routes.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const reloadedEntriesResponse = await axios.get(`${baseUrl}/api/output-profiles/default/entries`);
    expect(
      reloadedEntriesResponse.data.channels.find(entry => entry.canonical.id === first.canonical.id)
    ).to.include({
      position: 1,
      enabled: false,
    });
    expect(
      reloadedEntriesResponse.data.channels.find(entry => entry.canonical.id === second.canonical.id)
    ).to.include({
      position: 0,
      enabled: true,
      guideNumberOverride: '900',
    });
  });

  it('creates, updates, and deletes named output profiles', async () => {
    const createResponse = await axios.post(`${baseUrl}/api/output-profiles`, {
      name: 'Bedroom TV',
      copyFromSlug: 'default',
      enabled: false,
    });
    expect(createResponse.status).to.equal(201);
    expect(createResponse.data.profile).to.include({
      name: 'Bedroom TV',
      slug: 'bedroom-tv',
      enabled: false,
    });

    const profilesResponse = await axios.get(`${baseUrl}/api/output-profiles`);
    expect(profilesResponse.data.profiles.map(profile => profile.slug)).to.include.members([
      'default',
      'bedroom-tv',
    ]);

    const copiedEntriesResponse = await axios.get(`${baseUrl}/api/output-profiles/bedroom-tv/entries`);
    expect(copiedEntriesResponse.data.channels).to.have.lengthOf(2);

    const updateResponse = await axios.patch(`${baseUrl}/api/output-profiles/bedroom-tv`, {
      name: 'Bedroom TV Night',
      enabled: true,
    });
    expect(updateResponse.data.profile).to.include({
      name: 'Bedroom TV Night',
      slug: 'bedroom-tv',
      enabled: true,
    });

    const deleteDefaultResponse = await axios.delete(`${baseUrl}/api/output-profiles/default`, {
      validateStatus: () => true,
    });
    expect(deleteDefaultResponse.status).to.equal(400);
    expect(deleteDefaultResponse.data.error).to.equal('Default output profile cannot be deleted');

    const deleteResponse = await axios.delete(`${baseUrl}/api/output-profiles/bedroom-tv`);
    expect(deleteResponse.data).to.deep.equal({ status: 'deleted', slug: 'bedroom-tv' });

    const reloadedProfilesResponse = await axios.get(`${baseUrl}/api/output-profiles`);
    expect(reloadedProfilesResponse.data.profiles.map(profile => profile.slug)).to.deep.equal([
      'default',
    ]);
  });

  it('proxies output profile channel logos for preview consumers', async () => {
    const channelsResponse = await axios.get(`${baseUrl}/api/output-profiles/default/channels`);
    expect(channelsResponse.data.channels).to.have.lengthOf(2);
    expect(channelsResponse.data.channels[0].logo).to.match(
      /^http:\/\/localhost:\d+\/images\/IPTV%20One\/http%3A%2F%2Flogos\.example%2Fone\.png$/
    );
  });

  it('serves profile-specific lineup and XMLTV routes for enabled named profiles', async () => {
    await axios.post(`${baseUrl}/api/output-profiles`, {
      name: 'Bedroom TV',
      copyFromSlug: 'default',
      enabled: true,
    });

    const entriesResponse = await axios.get(`${baseUrl}/api/output-profiles/bedroom-tv/entries`);
    const channelOne = entriesResponse.data.channels.find(entry => entry.canonical.tvg_id === 'output.1');
    const channelTwo = entriesResponse.data.channels.find(entry => entry.canonical.tvg_id === 'output.2');

    await axios.patch(`${baseUrl}/api/output-profiles/bedroom-tv/channels`, {
      channels: [
        {
          canonicalId: channelOne.canonical.id,
          position: 0,
          enabled: false,
          guideNumberOverride: null,
        },
        {
          canonicalId: channelTwo.canonical.id,
          position: 1,
          enabled: true,
          guideNumberOverride: '902',
        },
      ],
    });

    const lineupJsonResponse = await axios.get(`${baseUrl}/profiles/bedroom-tv/lineup.json`);
    expect(lineupJsonResponse.data).to.have.lengthOf(1);
    expect(lineupJsonResponse.data[0]).to.include({
      GuideName: 'Canonical Two',
      GuideNumber: '902',
    });

    const lineupM3uResponse = await axios.get(`${baseUrl}/profiles/bedroom-tv/lineup.m3u`);
    expect(lineupM3uResponse.data).to.include(
      `url-tvg="${baseUrl.replace('127.0.0.1', 'localhost')}/profiles/bedroom-tv/xmltv.xml"`
    );
    expect(lineupM3uResponse.data).to.include('Canonical Two');
    expect(lineupM3uResponse.data).not.to.include('Canonical One');

    const xmltvResponse = await axios.get(`${baseUrl}/profiles/bedroom-tv/xmltv.xml`);
    expect(xmltvResponse.data).to.include('<channel id="output.2">');
    expect(xmltvResponse.data).to.include('Channel Two Show');
    expect(xmltvResponse.data).not.to.include('<channel id="output.1">');
    expect(xmltvResponse.data).not.to.include('Channel One Show');
  });

  it('isolates XMLTV by profile and intersects source and channel filters with profile membership', async () => {
    await axios.post(`${baseUrl}/api/output-profiles`, {
      name: 'Bedroom TV',
      copyFromSlug: 'default',
      enabled: true,
    });
    const bedroomEntries = await axios.get(`${baseUrl}/api/output-profiles/bedroom-tv/entries`);
    await axios.patch(`${baseUrl}/api/output-profiles/bedroom-tv/channels`, {
      channels: bedroomEntries.data.channels.map((entry, position) => ({
        canonicalId: entry.canonical.id,
        position,
        enabled: entry.canonical.tvg_id === 'output.2',
        guideNumberOverride: entry.guideNumberOverride,
      })),
    });

    // Fetch the named response first to prove it cannot poison the default
    // response cache with its narrower membership.
    const bedroomGuide = await axios.get(`${baseUrl}/profiles/bedroom-tv/xmltv.xml`);
    expect(bedroomGuide.data).to.include('<channel id="output.2">');
    expect(bedroomGuide.data).to.not.include('<channel id="output.1">');

    const defaultGuide = await axios.get(`${baseUrl}/xmltv.xml?channels=output.1,output.2`);
    expect(defaultGuide.data).to.include('<channel id="output.1">');
    expect(defaultGuide.data).to.include('<channel id="output.2">');

    const mismatchedFilters = await axios.get(
      `${baseUrl}/xmltv.xml?source=IPTV%20One&channels=output.2`
    );
    expect(mismatchedFilters.data).to.not.include('<channel id="output.1">');
    expect(mismatchedFilters.data).to.not.include('<channel id="output.2">');

    const matchingFilters = await axios.get(
      `${baseUrl}/xmltv.xml?source=IPTV%20One&channels=output.1`
    );
    expect(matchingFilters.data).to.include('<channel id="output.1">');
    expect(matchingFilters.data).to.not.include('<channel id="output.2">');

    const unknownSource = await axios.get(`${baseUrl}/xmltv.xml?source=not-configured`);
    expect(unknownSource.data).to.not.include('<channel id="output.1">');
    expect(unknownSource.data).to.not.include('<channel id="output.2">');

    await axios.post(`${baseUrl}/api/output-profiles`, {
      name: 'Empty TV',
      copyFromSlug: 'default',
      enabled: true,
    });
    const emptyEntries = await axios.get(`${baseUrl}/api/output-profiles/empty-tv/entries`);
    await axios.patch(`${baseUrl}/api/output-profiles/empty-tv/channels`, {
      channels: emptyEntries.data.channels.map((entry, position) => ({
        canonicalId: entry.canonical.id,
        position,
        enabled: false,
        guideNumberOverride: entry.guideNumberOverride,
      })),
    });

    const emptyGuide = await axios.get(`${baseUrl}/profiles/empty-tv/xmltv.xml`);
    expect(emptyGuide.data).to.not.include('<channel id="output.1">');
    expect(emptyGuide.data).to.not.include('<channel id="output.2">');
    expect(emptyGuide.data).to.not.include('<programme channel=');

    // The default route must remain tied to the default profile rather than
    // falling back to the enabled Bedroom profile used during guide merging.
    const defaultEntries = await axios.get(`${baseUrl}/api/output-profiles/default/entries`);
    await axios.patch(`${baseUrl}/api/output-profiles/default/channels`, {
      channels: defaultEntries.data.channels.map((entry, position) => ({
        canonicalId: entry.canonical.id,
        position,
        enabled: false,
        guideNumberOverride: entry.guideNumberOverride,
      })),
    });
    const emptyDefaultGuide = await axios.get(`${baseUrl}/xmltv.xml`);
    expect(emptyDefaultGuide.data).to.not.include('<channel id="output.1">');
    expect(emptyDefaultGuide.data).to.not.include('<channel id="output.2">');
    const stillPublishedBedroomGuide = await axios.get(`${baseUrl}/profiles/bedroom-tv/xmltv.xml`);
    expect(stillPublishedBedroomGuide.data).to.include('<channel id="output.2">');
  });

  it('keeps default aliases empty after an MCP update disables every profile entry', async () => {
    const entriesResponse = await axios.get(`${baseUrl}/api/output-profiles/default/entries`);
    const channels = entriesResponse.data.channels.map((entry, position) => ({
      canonicalId: entry.canonical.id,
      position,
      enabled: false,
      guideNumberOverride: entry.guideNumberOverride,
    }));

    const message = await callMcpTool(baseUrl, 'update_output_profile_channels', {
      slug: 'default',
      channels,
    });
    expect(message?.result?.isError).to.not.equal(true);

    const [defaultJson, namedJson, defaultM3u, namedM3u] = await Promise.all([
      axios.get(`${baseUrl}/lineup.json`),
      axios.get(`${baseUrl}/profiles/default/lineup.json`),
      axios.get(`${baseUrl}/lineup.m3u`),
      axios.get(`${baseUrl}/profiles/default/lineup.m3u`),
    ]);

    expect(defaultJson.data).to.deep.equal([]);
    expect(namedJson.data).to.deep.equal([]);
    expect(defaultM3u.data).to.not.include('Canonical One');
    expect(defaultM3u.data).to.not.include('Canonical Two');
    expect(namedM3u.data).to.not.include('Canonical One');
    expect(namedM3u.data).to.not.include('Canonical Two');

    const includeUnmapped = await axios.get(`${baseUrl}/lineup.json?include_unmapped=true`);
    expect(includeUnmapped.data).to.have.lengthOf(2);
  });

  it('keeps default aliases empty after an MCP update removes every effective guide number', async () => {
    databaseModule
      .getDatabase()
      .prepare("UPDATE canonical_channels SET guide_number = ''")
      .run();

    const entriesResponse = await axios.get(`${baseUrl}/api/output-profiles/default/entries`);
    const channels = entriesResponse.data.channels.map((entry, position) => ({
      canonicalId: entry.canonical.id,
      position,
      enabled: true,
      guideNumberOverride: null,
    }));

    const message = await callMcpTool(baseUrl, 'update_output_profile_channels', {
      slug: 'default',
      channels,
    });
    expect(message?.result?.isError).to.not.equal(true);

    const [defaultJson, namedJson, defaultM3u, namedM3u] = await Promise.all([
      axios.get(`${baseUrl}/lineup.json`),
      axios.get(`${baseUrl}/profiles/default/lineup.json`),
      axios.get(`${baseUrl}/lineup.m3u`),
      axios.get(`${baseUrl}/profiles/default/lineup.m3u`),
    ]);

    expect(defaultJson.data).to.deep.equal([]);
    expect(namedJson.data).to.deep.equal([]);
    expect(defaultM3u.data).to.not.include('Canonical One');
    expect(defaultM3u.data).to.not.include('Canonical Two');
    expect(namedM3u.data).to.not.include('Canonical One');
    expect(namedM3u.data).to.not.include('Canonical Two');
  });

  it('uses a custom canonical name in published outputs without changing the stream lookup path', async () => {
    const canonicalChannelsResponse = await axios.get(`${baseUrl}/api/canonical/channels`);
    const canonicalChannel = canonicalChannelsResponse.data.channels.find(
      channel => channel.tvg_id === 'output.1'
    );

    const updateResponse = await axios.patch(`${baseUrl}/api/canonical/channels/${canonicalChannel.id}`, {
      customName: 'Living Room One',
    });
    expect(updateResponse.data.channel).to.include({
      id: canonicalChannel.id,
      name: 'Living Room One',
      baseName: 'Canonical One',
      customName: 'Living Room One',
    });

    const outputChannelsResponse = await axios.get(`${baseUrl}/api/output-profiles/default/channels`);
    const renamedChannel = outputChannelsResponse.data.channels.find(
      channel => channel.canonicalId === canonicalChannel.id
    );
    expect(renamedChannel).to.include({
      name: 'Living Room One',
      streamName: 'Source One',
    });
    const publicBaseUrl = baseUrl.replace('127.0.0.1', 'localhost');
    expect(renamedChannel.sourceChannelId).to.be.a('string').and.not.empty;
    const stableStreamUrl = `${publicBaseUrl}/stream/channel/${encodeURIComponent(renamedChannel.sourceChannelId)}`;

    const lineupJsonResponse = await axios.get(`${baseUrl}/lineup.json`);
    expect(lineupJsonResponse.data.find(channel => channel.GuideName === 'Living Room One')).to.include({
      GuideName: 'Living Room One',
      URL: stableStreamUrl,
    });

    const lineupM3uResponse = await axios.get(`${baseUrl}/lineup.m3u`);
    expect(lineupM3uResponse.data).to.include('Living Room One');
    expect(lineupM3uResponse.data).to.include(stableStreamUrl);
    expect(lineupM3uResponse.data).not.to.include(
      `${publicBaseUrl}/stream/IPTV%20One/Living%20Room%20One`
    );

    const xmltvResponse = await axios.get(`${baseUrl}/xmltv.xml`);
    expect(xmltvResponse.data).to.include('<channel id="output.1">');
    expect(xmltvResponse.data).to.include('Living Room One');
  });

  it('returns 404 for disabled named profile public routes', async () => {
    await axios.post(`${baseUrl}/api/output-profiles`, {
      name: 'Guest Room',
      copyFromSlug: 'default',
      enabled: false,
    });

    const response = await axios.get(`${baseUrl}/profiles/guest-room/lineup.json`, {
      validateStatus: () => true,
    });

    expect(response.status).to.equal(404);
  });
});
