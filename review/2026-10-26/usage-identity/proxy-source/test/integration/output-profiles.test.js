import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';
import axios from 'axios';
import express from 'express';
import nock from 'nock';

describe('output profile persistence', () => {
  let configDir;
  let dataDir;
  let parseM3UModule;
  let outputProfileService;
  let canonicalService;
  let sourceService;
  let databaseModule;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-output-config-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-output-data-'));

    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;

    await fs.writeFile(
      path.join(configDir, 'providers.yaml'),
      [
        'providers:',
        '  - name: IPTV One',
        '    url: "http://output.example/one.m3u"',
        '    type: "m3u"',
        '  - name: IPTV Two',
        '    url: "http://output.example/two.m3u"',
        '    type: "m3u"',
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(configDir, 'channel-map.yaml'),
      [
        "'Source One':",
        "  name: 'Canonical Output'",
        "  tvg_id: 'output.1'",
        "  number: '201'",
        "'Source Two':",
        "  name: 'Canonical Output'",
        "  tvg_id: 'output.1'",
        "  number: '201'",
      ].join('\n'),
      'utf8'
    );

    parseM3UModule = await import(`../../scripts/parseM3U.js?test=${Date.now()}`);
    outputProfileService = await import(`../../libs/output-profile-service.js?test=${Date.now()}`);
    canonicalService = await import(`../../libs/canonical-channel-service.js?test=${Date.now()}`);
    sourceService = await import(`../../libs/source-service.js?test=${Date.now()}`);
    databaseModule = await import('../../libs/database.js');
  });

  afterEach(async () => {
    nock.cleanAll();
    databaseModule.closeDatabase();
    delete process.env.CONFIG_PATH;
    delete process.env.DATA_PATH;
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('creates a default output profile backed by canonical channels', async () => {
    nock('http://output.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://output.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const profiles = outputProfileService.listOutputProfiles();
    expect(profiles).to.have.lengthOf(1);
    expect(profiles[0]).to.include({
      name: 'Default Output',
      slug: 'default',
      enabled: true,
    });

    const channels = outputProfileService.getOutputProfileChannels();
    expect(channels).to.have.lengthOf(1);
    expect(channels[0]).to.include({
      name: 'Canonical Output',
      tvg_id: 'output.1',
      guideNumber: '201',
    });
    expect(channels[0].source).to.be.oneOf(['IPTV One', 'IPTV Two']);
  });

  it('filters merged XMLTV output to the published default profile when available', async () => {
    const epgOnePath = path.join(configDir, 'one.xml');
    const epgTwoPath = path.join(configDir, 'two.xml');

    await fs.writeFile(
      epgOnePath,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv>',
        '  <channel id="output.1"><display-name>Canonical Output</display-name></channel>',
        '  <programme channel="output.1" start="20240101000000 +0000" stop="20240101010000 +0000">',
        '    <title>Published Show</title>',
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
        '  <channel id="output.1"><display-name>Canonical Output</display-name></channel>',
        '  <channel id="raw.two"><display-name>Source Two</display-name></channel>',
        '  <programme channel="output.1" start="20240101000000 +0000" stop="20240101010000 +0000">',
        '    <title>Published Show</title>',
        '  </programme>',
        '  <programme channel="raw.two" start="20240101000000 +0000" stop="20240101010000 +0000">',
        '    <title>Unpublished Show</title>',
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
        '    url: "http://output.example/one.m3u"',
        `    epg: "${pathToFileURL(epgOnePath).href}"`,
        '    type: "m3u"',
        '  - name: IPTV Two',
        '    url: "http://output.example/two.m3u"',
        `    epg: "${pathToFileURL(epgTwoPath).href}"`,
        '    type: "m3u"',
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(path.join(configDir, 'app.yaml'), '{}\n', 'utf8');

    nock('http://output.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://output.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const app = express();
    const epgModule = await import(`../../server/epg.js?test=${Date.now()}`);
    const { errorHandler } = await import(`../../server/error-handler.js?test=${Date.now()}`);
    await epgModule.setupEPGRoutes(app);
    app.use(errorHandler);

    const server = await new Promise(resolve => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const response = await axios.get(`${baseUrl}/xmltv.xml`);

      expect(response.status).to.equal(200);
      expect(response.data).to.include('<channel id="output.1">');
      expect(response.data).to.include('Published Show');
      expect(response.data).not.to.include('raw.two');
      expect(response.data).not.to.include('Unpublished Show');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('uses the selected guide binding source and rewrites XMLTV ids to the canonical channel id', async () => {
    const epgOnePath = path.join(configDir, 'one.xml');
    const epgTwoPath = path.join(configDir, 'two.xml');

    await fs.writeFile(
      epgOnePath,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv>',
        '  <channel id="raw.one.epg"><display-name>Source One Guide</display-name></channel>',
        '  <programme channel="raw.one.epg" start="20240101000000 +0000" stop="20240101010000 +0000">',
        '    <title>Source One Show</title>',
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
        '  <channel id="raw.two.epg"><display-name>Source Two Guide</display-name></channel>',
        '  <programme channel="raw.two.epg" start="20240101000000 +0000" stop="20240101010000 +0000">',
        '    <title>Source Two Show</title>',
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
        '    url: "http://output.example/one.m3u"',
        `    epg: "${pathToFileURL(epgOnePath).href}"`,
        '    type: "m3u"',
        '  - name: IPTV Two',
        '    url: "http://output.example/two.m3u"',
        `    epg: "${pathToFileURL(epgTwoPath).href}"`,
        '    type: "m3u"',
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(path.join(configDir, 'app.yaml'), '{}\n', 'utf8');

    nock('http://output.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://output.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const canonicalChannel = canonicalService.listCanonicalChannels()[0];
    const sourceTwoGuideBinding = canonicalService
      .listGuideBindings()
      .find(binding => binding.canonical.id === canonicalChannel.id && binding.source.name === 'IPTV Two');
    canonicalService.setCanonicalChannelGuideBinding(
      canonicalChannel.id,
      sourceTwoGuideBinding.source.id,
      'raw.two.epg'
    );

    const app = express();
    const epgModule = await import(`../../server/epg.js?test=${Date.now()}`);
    const { errorHandler } = await import(`../../server/error-handler.js?test=${Date.now()}`);
    await epgModule.setupEPGRoutes(app);
    app.use(errorHandler);

    const server = await new Promise(resolve => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const response = await axios.get(`${baseUrl}/xmltv.xml`);

      expect(response.status).to.equal(200);
      expect(response.data).to.include('<channel id="output.1">');
      expect(response.data).to.include('<programme channel="output.1"');
      expect(response.data).to.include('Source Two Show');
      expect(response.data).not.to.include('Source One Show');
      expect(response.data).not.to.include('raw.two.epg');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('fans one selected source guide channel out to every canonical output and deduplicates it', async () => {
    const epgPath = path.join(configDir, 'fanout.xml');
    await fs.writeFile(
      epgPath,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv>',
        '  <channel id="shared.guide"><display-name>Shared Guide</display-name></channel>',
        '  <programme channel="shared.guide" start="20250101000000 +0000" stop="20250101010000 +0000">',
        '    <title lang="en">Shared Show</title><title lang="fr">Programme partage</title><desc>First copy</desc>',
        '  </programme>',
        '  <programme channel="shared.guide" start="20250101000000 +0000" stop="20250101013000 +0000">',
        '    <title>Shared Show</title><desc>Duplicate must not win</desc>',
        '  </programme>',
        '</tv>',
      ].join('\n'),
      'utf8'
    );

    nock('http://output.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://output.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );
    await parseM3UModule.parseAll();

    const db = databaseModule.getDatabase();
    const source = db.prepare("SELECT id FROM sources WHERE name = 'IPTV One'").get();
    const sourceChannel = db
      .prepare(
        `SELECT sc.id
           FROM source_channels sc
           JOIN sources s ON s.id = sc.source_id
          WHERE s.name = 'IPTV One'
          LIMIT 1`
      )
      .get();
    const firstCanonical = canonicalService.listCanonicalChannels()[0];
    const defaultProfile = db.prepare("SELECT id FROM output_profiles WHERE slug = 'default'").get();
    const now = new Date().toISOString();
    const secondCanonicalId = 'fanout-canonical-two';

    db.prepare('UPDATE sources SET epg_url = ? WHERE id = ?').run(pathToFileURL(epgPath).href, source.id);
    db.prepare('UPDATE channel_bindings SET is_preferred_stream = 0 WHERE canonical_channel_id = ?').run(
      firstCanonical.id
    );
    db.prepare(
      `UPDATE channel_bindings
          SET is_preferred_stream = 1
        WHERE canonical_channel_id = ? AND source_channel_id = ?`
    ).run(firstCanonical.id, sourceChannel.id);
    db.prepare('DELETE FROM guide_bindings').run();
    db.prepare(
      `INSERT INTO canonical_channels (
        id, slug, name, custom_name, tvg_id, guide_number, logo, group_name, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      secondCanonicalId,
      'fanout-two',
      'Canonical Fanout Two',
      null,
      'output.fanout.two',
      '902',
      null,
      null,
      1,
      now,
      now
    );
    db.prepare(
      `INSERT INTO channel_bindings (
        id, source_channel_id, canonical_channel_id, binding_type, priority, is_preferred_stream, confidence, resolution_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'fanout-channel-binding',
      sourceChannel.id,
      secondCanonicalId,
      'mapping',
      0,
      1,
      1,
      'resolved'
    );
    for (const canonicalId of [firstCanonical.id, secondCanonicalId]) {
      db.prepare(
        `INSERT INTO guide_bindings (id, canonical_channel_id, source_id, epg_channel_id, priority)
         VALUES (?, ?, ?, ?, ?)`
      ).run(`fanout-guide-${canonicalId}`, canonicalId, source.id, 'shared.guide', 0);
    }
    db.prepare(
      `INSERT INTO output_profile_channels (
        id, output_profile_id, canonical_channel_id, position, guide_number_override, enabled
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('fanout-output-entry', defaultProfile.id, secondCanonicalId, 1, null, 1);

    const app = express();
    const epgModule = await import(`../../server/epg.js?test=${Date.now()}`);
    const { errorHandler } = await import(`../../server/error-handler.js?test=${Date.now()}`);
    await epgModule.setupEPGRoutes(app);
    app.use(errorHandler);
    const server = await new Promise(resolve => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });

    try {
      const response = await axios.get(`http://127.0.0.1:${server.address().port}/xmltv.xml`);
      expect(response.data.match(/<channel id="output\.1">/g)).to.have.lengthOf(1);
      expect(response.data.match(/<channel id="output\.fanout\.two">/g)).to.have.lengthOf(1);
      expect(response.data.match(/<programme channel="output\.1"/g)).to.have.lengthOf(1);
      expect(response.data.match(/<programme channel="output\.fanout\.two"/g)).to.have.lengthOf(1);
      expect(response.data).to.include('<title lang="en">Shared Show</title>');
      expect(response.data).to.include('<title lang="fr">Programme partage</title>');
      expect(response.data).to.not.include('Duplicate must not win');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('preserves output profile entry settings across reloads', async () => {
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

    nock('http://output.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://output.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const entries = outputProfileService.listOutputProfileEntries('default');
    expect(entries).to.have.lengthOf(2);

    const updatedEntries = outputProfileService.updateOutputProfileEntries('default', [
      {
        canonicalId: entries[0].canonical.id,
        position: 1,
        enabled: false,
        guideNumberOverride: null,
      },
      {
        canonicalId: entries[1].canonical.id,
        position: 0,
        enabled: true,
        guideNumberOverride: '900',
      },
    ]);

    expect(updatedEntries.find(entry => entry.canonical.id === entries[0].canonical.id)).to.include({
      position: 1,
      enabled: false,
    });
    expect(updatedEntries.find(entry => entry.canonical.id === entries[1].canonical.id)).to.include({
      position: 0,
      enabled: true,
      guideNumberOverride: '900',
    });

    nock('http://output.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://output.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const reloadedEntries = outputProfileService.listOutputProfileEntries('default');
    expect(reloadedEntries.find(entry => entry.canonical.id === entries[0].canonical.id)).to.include({
      position: 1,
      enabled: false,
    });
    expect(reloadedEntries.find(entry => entry.canonical.id === entries[1].canonical.id)).to.include({
      position: 0,
      enabled: true,
      guideNumberOverride: '900',
    });

    const publishedChannels = outputProfileService.getOutputProfileChannels('default');
    expect(publishedChannels).to.have.lengthOf(1);
    expect(publishedChannels[0]).to.include({
      name: 'Canonical Two',
      guideNumber: '900',
      position: 0,
    });
  });

  it('supports creating, updating, deleting, and resyncing named output profiles', async () => {
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

    nock('http://output.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://output.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const defaultEntries = outputProfileService.listOutputProfileEntries('default');
    outputProfileService.updateOutputProfileEntries('default', [
      {
        canonicalId: defaultEntries[0].canonical.id,
        position: 1,
        enabled: false,
        guideNumberOverride: null,
      },
      {
        canonicalId: defaultEntries[1].canonical.id,
        position: 0,
        enabled: true,
        guideNumberOverride: '900',
      },
    ]);

    const copiedProfile = outputProfileService.createOutputProfile({
      name: 'Bedroom TV',
      copyFromSlug: 'default',
      enabled: false,
    });
    expect(copiedProfile).to.include({
      name: 'Bedroom TV',
      slug: 'bedroom-tv',
      enabled: false,
      isDefault: false,
    });

    const copiedEntries = outputProfileService.listOutputProfileEntries('bedroom-tv');
    expect(copiedEntries.find(entry => entry.canonical.id === defaultEntries[0].canonical.id)).to.include({
      enabled: false,
      position: 1,
    });
    expect(copiedEntries.find(entry => entry.canonical.id === defaultEntries[1].canonical.id)).to.include({
      enabled: true,
      position: 0,
      guideNumberOverride: '900',
    });

    const updatedProfile = outputProfileService.updateOutputProfile('bedroom-tv', {
      name: 'Bedroom TV Night',
      enabled: true,
    });
    expect(updatedProfile).to.include({
      name: 'Bedroom TV Night',
      slug: 'bedroom-tv',
      enabled: true,
    });

    sourceService.replaceProvidersConfig({
      providers: [
        { name: 'IPTV One', url: 'http://output.example/one.m3u', type: 'm3u' },
        { name: 'IPTV Two', url: 'http://output.example/two.m3u', type: 'm3u' },
        { name: 'IPTV Three', url: 'http://output.example/three.m3u', type: 'm3u' },
      ],
    });
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
        "'Source Three':",
        "  name: 'Canonical Three'",
        "  tvg_id: 'output.3'",
        "  number: '203'",
      ].join('\n'),
      'utf8'
    );

    nock('http://output.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://output.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );
    nock('http://output.example')
      .get('/three.m3u')
      .reply(
        200,
        [
          '#EXTM3U',
          '#EXTINF:-1 tvg-id="raw.three",Source Three',
          'http://streams.example/three',
        ].join('\n')
      );

    await parseM3UModule.parseAll();

    const resyncedEntries = outputProfileService.listOutputProfileEntries('bedroom-tv');
    expect(resyncedEntries).to.have.lengthOf(3);
    expect(
      resyncedEntries.find(entry => entry.canonical.name === 'Canonical Two')
    ).to.include({
      enabled: true,
      guideNumberOverride: '900',
    });
    expect(
      resyncedEntries.find(entry => entry.canonical.name === 'Canonical Three')
    ).to.include({
      enabled: true,
      guideNumberOverride: null,
    });

    expect(outputProfileService.deleteOutputProfile('default')).to.deep.equal({
      error: 'default-profile-required',
    });
    expect(outputProfileService.deleteOutputProfile('bedroom-tv')).to.deep.equal({
      deleted: true,
      slug: 'bedroom-tv',
    });
    expect(outputProfileService.listOutputProfiles().map(profile => profile.slug)).to.deep.equal([
      'default',
    ]);
  });

  it('treats channels without a guide number as disabled in output profiles', async () => {
    await fs.writeFile(
      path.join(configDir, 'channel-map.yaml'),
      [
        "'Source One':",
        "  name: 'Canonical One'",
        "  tvg_id: 'output.1'",
      ].join('\n'),
      'utf8'
    );

    nock('http://output.example')
      .get('/one.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.one",Source One', 'http://streams.example/one'].join(
          '\n'
        )
      );
    nock('http://output.example')
      .get('/two.m3u')
      .reply(
        200,
        ['#EXTM3U', '#EXTINF:-1 tvg-id="raw.two",Source Two', 'http://streams.example/two'].join(
          '\n'
        )
      );

    await parseM3UModule.parseAll();

    const entries = outputProfileService.listOutputProfileEntries('default');
    expect(entries).to.have.lengthOf(2);
    expect(entries.find(entry => entry.canonical.name === 'Canonical One')).to.include({
      enabled: false,
    });

    const updatedEntries = outputProfileService.updateOutputProfileEntries('default', [
      {
        canonicalId: entries[0].canonical.id,
        position: entries[0].position,
        enabled: true,
        guideNumberOverride: null,
      },
      {
        canonicalId: entries[1].canonical.id,
        position: entries[1].position,
        enabled: false,
        guideNumberOverride: null,
      },
    ]);

    expect(updatedEntries.find(entry => entry.canonical.name === 'Canonical One')).to.include({
      enabled: false,
    });
    expect(outputProfileService.getOutputProfileChannels('default')).to.have.lengthOf(0);
  });
});
