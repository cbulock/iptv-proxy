import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import nock from 'nock';

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
    lineupModule.setupLineupRoutes(app, {});
    await epgModule.setupEPGRoutes(app);
    app.use(canonicalRouter);
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
