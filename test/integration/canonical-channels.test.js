import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';

describe('canonical channel persistence', () => {
  let configDir;
  let dataDir;
  let parseM3UModule;
  let databaseModule;
  let canonicalService;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-canonical-config-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-canonical-data-'));

    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;

    await fs.writeFile(
      path.join(configDir, 'providers.yaml'),
      [
        'providers:',
        '  - name: IPTV One',
        '    url: "http://canonical.example/one.m3u"',
        '    epg: "http://canonical.example/one.xml"',
        '    type: "m3u"',
        '  - name: IPTV Two',
        '    url: "http://canonical.example/two.m3u"',
        '    epg: "http://canonical.example/two.xml"',
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

    parseM3UModule = await import(`../../scripts/parseM3U.js?test=${Date.now()}`);
    databaseModule = await import('../../libs/database.js');
    canonicalService = await import(`../../libs/canonical-channel-service.js?test=${Date.now()}`);
  });

  afterEach(async () => {
    nock.cleanAll();
    databaseModule.closeDatabase();
    delete process.env.CONFIG_PATH;
    delete process.env.DATA_PATH;
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('builds canonical channels and bindings from discovered source channels', async () => {
    nock('http://canonical.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://canonical.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    const count = await parseM3UModule.parseAll();
    expect(count).to.equal(2);

    const canonicalChannels = canonicalService.listCanonicalChannels();
    expect(canonicalChannels).to.have.lengthOf(1);
    expect(canonicalChannels[0]).to.include({
      name: 'Canonical Channel',
      tvg_id: 'canonical.1',
      guideNumber: '101',
      published: true,
    });

    const bindings = canonicalService.listChannelBindings();
    expect(bindings).to.have.lengthOf(2);
    expect(bindings.every(binding => binding.canonical.name === 'Canonical Channel')).to.equal(
      true
    );
    expect(bindings.filter(binding => binding.isPreferredStream)).to.have.lengthOf(1);
    const guideBindings = canonicalService.listGuideBindings();
    expect(guideBindings).to.have.lengthOf(2);
    expect(guideBindings.filter(binding => binding.selected)).to.have.lengthOf(1);
  });

  it('preserves the preferred binding across reloads', async () => {
    nock('http://canonical.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://canonical.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const canonicalChannels = canonicalService.listCanonicalChannels();
    const bindings = canonicalService.listChannelBindings();
    const nonPreferred = bindings.find(binding => !binding.isPreferredStream);

    const updatedBinding = canonicalService.setCanonicalChannelPreferredStream(
      canonicalChannels[0].id,
      nonPreferred.sourceChannel.id
    );
    expect(updatedBinding).to.not.equal(null);
    expect(updatedBinding.isPreferredStream).to.equal(true);

    nock('http://canonical.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://canonical.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const reloadedBindings = canonicalService.listChannelBindings();
    const preferredAfterReload = reloadedBindings.find(binding => binding.isPreferredStream);
    expect(preferredAfterReload.sourceChannel.id).to.equal(nonPreferred.sourceChannel.id);
  });

  it('preserves the selected guide binding and epg channel id across reloads', async () => {
    nock('http://canonical.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://canonical.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const canonicalChannel = canonicalService.listCanonicalChannels()[0];
    const guideBindings = canonicalService.listGuideBindings();
    const nonSelected = guideBindings.find(binding => !binding.selected);

    const updatedBinding = canonicalService.setCanonicalChannelGuideBinding(
      canonicalChannel.id,
      nonSelected.source.id,
      'raw.two.epg'
    );
    expect(updatedBinding).to.not.equal(null);
    expect(updatedBinding.selected).to.equal(true);
    expect(updatedBinding.epgChannelId).to.equal('raw.two.epg');

    nock('http://canonical.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://canonical.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const reloadedGuideBindings = canonicalService.listGuideBindings();
    const selectedAfterReload = reloadedGuideBindings.find(
      binding => binding.canonical.id === canonicalChannel.id && binding.selected
    );
    expect(selectedAfterReload.source.id).to.equal(nonSelected.source.id);
    expect(selectedAfterReload.epgChannelId).to.equal('raw.two.epg');
  });

  it('assigns unique slugs when multiple canonical channels normalize to the same base slug', async () => {
    await fs.writeFile(path.join(configDir, 'channel-map.yaml'), '{}\n', 'utf8');

    nock('http://canonical.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1,My TV', 'http://streams.example/one'].join('\n')
      );
    nock('http://canonical.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1,My-TV', 'http://streams.example/two'].join('\n')
      );

    const count = await parseM3UModule.parseAll();
    expect(count).to.equal(2);

    const canonicalChannels = canonicalService.listCanonicalChannels();
    expect(canonicalChannels).to.have.lengthOf(2);
    expect(new Set(canonicalChannels.map(channel => channel.slug)).size).to.equal(2);
  });

  it('creates guide bindings for direct stream channels when the source has EPG configured', async () => {
    await fs.writeFile(
      path.join(configDir, 'providers.yaml'),
      [
        'providers:',
        '  - name: NAS Stream',
        '    url: "http://nas6:8081/hls/stream.m3u8"',
        '    epg: "http://nas6:8081/epg.xml"',
        '    type: "m3u"',
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(path.join(configDir, 'channel-map.yaml'), '{}\n', 'utf8');

    nock('http://nas6:8081')
      .get('/hls/stream.m3u8')
      .reply(
        200,
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-TARGETDURATION:6',
          '#EXTINF:6.006,',
          'segment000.ts',
          '#EXT-X-ENDLIST',
        ].join('\n')
      );

    const count = await parseM3UModule.parseAll();
    expect(count).to.equal(1);

    const canonicalChannels = canonicalService.listCanonicalChannels();
    expect(canonicalChannels).to.have.lengthOf(1);
    expect(canonicalChannels[0]).to.include({
      name: 'NAS Stream',
      tvg_id: null,
    });

    const guideBindings = canonicalService.listGuideBindings();
    expect(guideBindings).to.have.lengthOf(1);
    expect(guideBindings[0]).to.include({
      epgChannelId: 'NAS Stream',
      selected: true,
    });
    expect(guideBindings[0].source.name).to.equal('NAS Stream');
    expect(guideBindings[0].canonical.id).to.equal(canonicalChannels[0].id);
  });
});
