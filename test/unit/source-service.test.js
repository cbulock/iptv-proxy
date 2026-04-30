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
    expect(storedProviders).to.deep.equal({
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

    const providersYaml = await fs.readFile(path.join(configDir, 'providers.yaml'), 'utf8');
    expect(providersYaml).to.include('name: Antenna');
    expect(providersYaml).to.include('type: hdhomerun');
    expect(providersYaml).to.include('epg: https://remote.example/guide.xml');
  });
});
