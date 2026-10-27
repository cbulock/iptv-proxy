import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';

describe('source service', () => {
  let configDir;
  let dataDir;
  let sourceService;
  let databaseModule;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-sources-config-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-sources-data-'));

    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;

    await fs.writeFile(
      path.join(configDir, 'providers.yaml'),
      [
        'providers:',
        '  - name: Seeded IPTV',
        '    url: "http://seed.example/playlist.m3u"',
        '    type: "m3u"',
        '    epg: "http://seed.example/epg.xml"',
      ].join('\n'),
      'utf8'
    );

    sourceService = await import(`../../libs/source-service.js?test=${Date.now()}`);
    databaseModule = await import('../../libs/database.js');
  });

  afterEach(async () => {
    databaseModule.closeDatabase();
    delete process.env.CONFIG_PATH;
    delete process.env.DATA_PATH;
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('seeds sources from providers.yaml when the database is empty', () => {
    const sources = sourceService.listSources();

    expect(sources).to.have.lengthOf(1);
    expect(sources[0]).to.include({
      name: 'Seeded IPTV',
      url: 'http://seed.example/playlist.m3u',
      type: 'm3u',
      epg: 'http://seed.example/epg.xml',
      enabled: true,
    });
  });

  it('replaces stored sources and exports the compatibility providers.yaml file', async () => {
    sourceService.replaceProvidersConfig({
      providers: [
        {
          name: 'Antenna',
          url: 'http://hdhr.local',
          type: 'hdhomerun',
        },
        {
          name: 'Remote IPTV',
          url: 'https://remote.example/playlist.m3u',
          type: 'm3u',
          epg: 'https://remote.example/guide.xml',
        },
      ],
    });

    const storedProviders = sourceService.loadProvidersConfigFromStore();
    expect(storedProviders.providers).to.have.lengthOf(2);
    expect(
      storedProviders.providers.map(({ id: _id, ...provider }) => provider)
    ).to.deep.equal([
      {
        name: 'Antenna',
        url: 'http://hdhr.local',
        type: 'hdhomerun',
      },
      {
        name: 'Remote IPTV',
        url: 'https://remote.example/playlist.m3u',
        type: 'm3u',
        epg: 'https://remote.example/guide.xml',
      },
    ]);
    expect(storedProviders.providers.every(provider => typeof provider.id === 'string')).to.equal(true);

    const providersYaml = await fs.readFile(path.join(configDir, 'providers.yaml'), 'utf8');
    expect(providersYaml).to.include('name: Antenna');
    expect(providersYaml).to.include('id:');
    expect(providersYaml).to.include('type: hdhomerun');
    expect(providersYaml).to.include('epg: https://remote.example/guide.xml');
  });

  it('preserves source relationships for unchanged and EPG-only provider saves', () => {
    const [source] = sourceService.listSources();
    const db = databaseModule.getDatabase();
    const timestamp = new Date().toISOString();
    const canonicalId = 'canonical-preserved';
    const channelId = 'source-channel-preserved';

    db.prepare(
      `INSERT INTO canonical_channels (
        id, slug, name, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(canonicalId, 'preserved', 'Preserved', 1, timestamp, timestamp);
    db.prepare(
      `INSERT INTO source_channels (
        id, source_id, external_key, name, last_seen_at
      ) VALUES (?, ?, ?, ?, ?)`
    ).run(channelId, source.id, 'preserved-key', 'Preserved Source Channel', timestamp);
    db.prepare(
      `INSERT INTO channel_bindings (
        id, source_channel_id, canonical_channel_id, binding_type, priority, is_preferred_stream, resolution_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('binding-preserved', channelId, canonicalId, 'source', 0, 1, 'resolved');
    db.prepare(
      `INSERT INTO guide_bindings (id, canonical_channel_id, source_id, epg_channel_id, priority)
       VALUES (?, ?, ?, ?, ?)`
    ).run('guide-preserved', canonicalId, source.id, 'preserved.guide', 0);
    db.prepare(
      `INSERT INTO source_sync_runs (id, source_id, kind, status, started_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run('sync-preserved', source.id, 'channels', 'success', timestamp);

    const savedConfig = sourceService.loadProvidersConfigFromStore();
    sourceService.replaceProvidersConfig(savedConfig);
    sourceService.replaceProvidersConfig({
      providers: [{ ...savedConfig.providers[0], epg: 'http://seed.example/updated.xml' }],
    });

    expect(sourceService.listSources()).to.deep.include({
      id: source.id,
      name: 'Seeded IPTV',
      url: 'http://seed.example/playlist.m3u',
      type: 'm3u',
      epg: 'http://seed.example/updated.xml',
      enabled: true,
    });
    expect(db.prepare('SELECT id, source_id FROM source_channels').all()).to.deep.equal([
      { id: channelId, source_id: source.id },
    ]);
    expect(db.prepare('SELECT source_channel_id, canonical_channel_id FROM channel_bindings').all()).to.deep.equal([
      { source_channel_id: channelId, canonical_channel_id: canonicalId },
    ]);
    expect(db.prepare('SELECT source_id FROM guide_bindings').all()).to.deep.equal([
      { source_id: source.id },
    ]);
    expect(db.prepare('SELECT source_id FROM source_sync_runs').all()).to.deep.equal([
      { source_id: source.id },
    ]);
  });

  it('deletes relationships only for providers omitted from the saved configuration', () => {
    const [source] = sourceService.listSources();
    const db = databaseModule.getDatabase();
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO source_channels (id, source_id, name, last_seen_at) VALUES (?, ?, ?, ?)').run(
      'removed-source-channel',
      source.id,
      'Will Be Removed',
      timestamp
    );

    sourceService.replaceProvidersConfig({ providers: [] });

    expect(db.prepare('SELECT COUNT(*) AS count FROM sources').get()).to.deep.equal({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM source_channels').get()).to.deep.equal({ count: 0 });
  });
});
