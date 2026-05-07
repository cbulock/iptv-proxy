import fs from 'fs/promises';
import os from 'os';
import path from 'path';
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

describe('canonical model routes', () => {
  let configDir;
  let dataDir;
  let server;
  let baseUrl;
  let parseM3UModule;
  let databaseModule;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-canonical-routes-config-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-canonical-routes-data-'));

    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;

    await fs.writeFile(
      path.join(configDir, 'providers.yaml'),
      [
        'providers:',
        '  - name: IPTV One',
        '    url: "http://canonical-routes.example/one.m3u"',
        '    epg: "http://canonical-routes.example/one.xml"',
        '    type: "m3u"',
        '  - name: IPTV Two',
        '    url: "http://canonical-routes.example/two.m3u"',
        '    epg: "http://canonical-routes.example/two.xml"',
        '    type: "m3u"',
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(configDir, 'channel-map.yaml'),
      [
        "'Source One':",
        "  name: 'Canonical Channel'",
        "  tvg_id: 'canonical.1'",
        "  number: '101'",
        "'Source Two':",
        "  name: 'Canonical Channel'",
        "  tvg_id: 'canonical.1'",
        "  number: '101'",
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(path.join(configDir, 'app.yaml'), '{}\n', 'utf8');

    nock('http://canonical-routes.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://canonical-routes.example')
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

    const canonicalRouter = (await import(`../../server/canonical.js?test=${Date.now()}`)).default;
    app.use(canonicalRouter);

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

  it('returns canonical channels and bindings', async () => {
    const [channelsResponse, bindingsResponse, guideBindingsResponse] = await Promise.all([
      axios.get(`${baseUrl}/api/canonical/channels`),
      axios.get(`${baseUrl}/api/canonical/bindings`),
      axios.get(`${baseUrl}/api/canonical/guide-bindings`),
    ]);

    expect(channelsResponse.data.channels).to.have.lengthOf(1);
    expect(channelsResponse.data.channels[0]).to.include({
      name: 'Canonical Channel',
      tvg_id: 'canonical.1',
      guideNumber: '101',
    });

    expect(bindingsResponse.data.bindings).to.have.lengthOf(2);
    expect(
      bindingsResponse.data.bindings.every(binding => binding.canonical.name === 'Canonical Channel')
    ).to.equal(true);
    expect(guideBindingsResponse.data.bindings).to.have.lengthOf(2);
    expect(guideBindingsResponse.data.bindings.filter(binding => binding.selected)).to.have.lengthOf(1);
  });

  it('returns discovered channels even when no channel-map entries exist', async () => {
    await fs.writeFile(path.join(configDir, 'channel-map.yaml'), '{}\n', 'utf8');

    nock('http://canonical-routes.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://canonical-routes.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const [channelsResponse, bindingsResponse] = await Promise.all([
      axios.get(`${baseUrl}/api/canonical/channels`),
      axios.get(`${baseUrl}/api/canonical/bindings`),
    ]);

    expect(channelsResponse.data.channels).to.have.lengthOf(2);
    expect(channelsResponse.data.channels.map(channel => channel.name)).to.have.members([
      'Source One',
      'Source Two',
    ]);
    expect(bindingsResponse.data.bindings).to.have.lengthOf(2);
    expect(bindingsResponse.data.bindings.every(binding => binding.bindingType === 'source')).to.equal(
      true
    );
  });

  it('rebuilds stale canonical data on read when source channels already exist', async () => {
    const db = databaseModule.getDatabase();
    db.exec(`
      DELETE FROM output_profile_channels;
      DELETE FROM guide_bindings;
      DELETE FROM channel_bindings;
      DELETE FROM canonical_channels;
    `);

    const [channelsResponse, bindingsResponse, outputChannelsResponse] = await Promise.all([
      axios.get(`${baseUrl}/api/canonical/channels`),
      axios.get(`${baseUrl}/api/canonical/bindings`),
      axios.get(`${baseUrl}/api/output-profiles/default/channels`),
    ]);

    expect(channelsResponse.data.channels).to.have.lengthOf(1);
    expect(channelsResponse.data.channels[0]).to.include({
      name: 'Canonical Channel',
      tvg_id: 'canonical.1',
      guideNumber: '101',
    });
    expect(bindingsResponse.data.bindings).to.have.lengthOf(2);
    expect(outputChannelsResponse.data.channels).to.have.lengthOf(1);
  });

  it('returns output profiles and their enabled channels', async () => {
    const profilesResponse = await axios.get(`${baseUrl}/api/output-profiles`);
    expect(profilesResponse.data.profiles).to.have.lengthOf(1);
    expect(profilesResponse.data.profiles[0]).to.include({
      name: 'Default Output',
      slug: 'default',
      enabled: true,
    });

    const channelsResponse = await axios.get(`${baseUrl}/api/output-profiles/default/channels`);
    expect(channelsResponse.data.channels).to.have.lengthOf(1);
    expect(channelsResponse.data.channels[0]).to.include({
      name: 'Canonical Channel',
      tvg_id: 'canonical.1',
      guideNumber: '101',
    });
  });

  it('updates canonical publish state and preserves it across a reload', async () => {
    const channelsResponse = await axios.get(`${baseUrl}/api/canonical/channels`);
    const canonicalChannel = channelsResponse.data.channels[0];

    const updateResponse = await axios.patch(
      `${baseUrl}/api/canonical/channels/${canonicalChannel.id}`,
      { published: false }
    );
    expect(updateResponse.data).to.include({ status: 'saved' });
    expect(updateResponse.data.channel).to.include({ id: canonicalChannel.id, published: false });

    const unchangedOutputResponse = await axios.get(`${baseUrl}/api/output-profiles/default/channels`);
    expect(unchangedOutputResponse.data.channels).to.have.lengthOf(1);

    nock('http://canonical-routes.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://canonical-routes.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const reloadedChannelsResponse = await axios.get(`${baseUrl}/api/canonical/channels`);
    expect(reloadedChannelsResponse.data.channels).to.have.lengthOf(1);
    expect(reloadedChannelsResponse.data.channels[0]).to.include({
      id: canonicalChannel.id,
      published: false,
    });

    const reloadedProfileResponse = await axios.get(`${baseUrl}/api/output-profiles/default/channels`);
    expect(reloadedProfileResponse.data.channels).to.have.lengthOf(1);
  });

  it('updates the preferred stream and preserves it across a reload', async () => {
    const bindingsResponse = await axios.get(`${baseUrl}/api/canonical/bindings`);
    const canonicalId = bindingsResponse.data.bindings[0].canonical.id;
    const initiallyPreferred = bindingsResponse.data.bindings.find(binding => binding.isPreferredStream);
    const nextPreferred = bindingsResponse.data.bindings.find(
      binding => binding.sourceChannel.id !== initiallyPreferred.sourceChannel.id
    );

    const updateResponse = await axios.patch(
      `${baseUrl}/api/canonical/channels/${canonicalId}/preferred-stream`,
      { sourceChannelId: nextPreferred.sourceChannel.id }
    );
    expect(updateResponse.data).to.include({ status: 'saved' });
    expect(updateResponse.data.binding.sourceChannel.id).to.equal(nextPreferred.sourceChannel.id);
    expect(updateResponse.data.binding.isPreferredStream).to.equal(true);

    const updatedProfileResponse = await axios.get(`${baseUrl}/api/output-profiles/default/channels`);
    expect(updatedProfileResponse.data.channels).to.have.lengthOf(1);
    expect(updatedProfileResponse.data.channels[0].source).to.equal(nextPreferred.sourceChannel.source);

    nock('http://canonical-routes.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://canonical-routes.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const reloadedBindingsResponse = await axios.get(`${baseUrl}/api/canonical/bindings`);
    const reloadedPreferred = reloadedBindingsResponse.data.bindings.find(
      binding => binding.canonical.id === canonicalId && binding.isPreferredStream
    );
    expect(reloadedPreferred.sourceChannel.id).to.equal(nextPreferred.sourceChannel.id);

    const reloadedProfileResponse = await axios.get(`${baseUrl}/api/output-profiles/default/channels`);
    expect(reloadedProfileResponse.data.channels).to.have.lengthOf(1);
    expect(reloadedProfileResponse.data.channels[0].source).to.equal(nextPreferred.sourceChannel.source);
  });

  it('updates the guide binding and preserves it across a reload', async () => {
    const guideBindingsResponse = await axios.get(`${baseUrl}/api/canonical/guide-bindings`);
    const canonicalId = guideBindingsResponse.data.bindings[0].canonical.id;
    const nextBinding = guideBindingsResponse.data.bindings.find(binding => !binding.selected);

    const updateResponse = await axios.patch(
      `${baseUrl}/api/canonical/channels/${canonicalId}/guide-binding`,
      {
        sourceId: nextBinding.source.id,
        epgChannelId: 'preferred.guide.id',
      }
    );
    expect(updateResponse.data).to.include({ status: 'saved' });
    expect(updateResponse.data.binding.source.id).to.equal(nextBinding.source.id);
    expect(updateResponse.data.binding.selected).to.equal(true);
    expect(updateResponse.data.binding.epgChannelId).to.equal('preferred.guide.id');

    nock('http://canonical-routes.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://canonical-routes.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const reloadedGuideBindings = await axios.get(`${baseUrl}/api/canonical/guide-bindings`);
    const selectedAfterReload = reloadedGuideBindings.data.bindings.find(
      binding => binding.canonical.id === canonicalId && binding.selected
    );
    expect(selectedAfterReload.source.id).to.equal(nextBinding.source.id);
    expect(selectedAfterReload.epgChannelId).to.equal('preferred.guide.id');
  });
});
