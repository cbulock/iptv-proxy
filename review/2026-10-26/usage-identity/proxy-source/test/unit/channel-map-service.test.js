import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';

describe('channel map service', () => {
  let configDir;
  let dataDir;
  let channelMapService;
  let databaseModule;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-channel-map-config-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-channel-map-data-'));

    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;

    await fs.writeFile(
      path.join(configDir, 'channel-map.yaml'),
      [
        "'Channel One':",
        "  name: 'Mapped Channel One'",
        "  number: '101'",
        "  tvg_id: 'mapped.one'",
        "  logo: 'http://images.example/one.png'",
        "'Channel Two':",
        "  url: 'http://streams.example/two'",
        "  group: 'News'",
      ].join('\n'),
      'utf8'
    );

    channelMapService = await import(`../../libs/channel-map-service.js?test=${Date.now()}`);
    databaseModule = await import('../../libs/database.js');
  });

  afterEach(async () => {
    databaseModule.closeDatabase();
    delete process.env.CONFIG_PATH;
    delete process.env.DATA_PATH;
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('seeds mappings from channel-map.yaml when the database is empty', () => {
    const mapping = channelMapService.loadChannelMapFromStore();

    expect(mapping).to.deep.equal({
      'Channel One': {
        name: 'Mapped Channel One',
        number: '101',
        tvg_id: 'mapped.one',
        logo: 'http://images.example/one.png',
      },
      'Channel Two': {
        url: 'http://streams.example/two',
        group: 'News',
      },
    });
  });

  it('replaces stored mappings and exports the compatibility channel-map.yaml file', async () => {
    channelMapService.replaceChannelMap({
      Alpha: {
        name: 'Alpha HD',
        number: '7.1',
        tvg_id: 'alpha.hd',
        url: 'http://streams.example/alpha',
        group: 'Local',
      },
      Beta: {
        logo: 'http://images.example/beta.png',
      },
    });

    expect(channelMapService.loadChannelMapFromStore()).to.deep.equal({
      Alpha: {
        name: 'Alpha HD',
        number: '7.1',
        tvg_id: 'alpha.hd',
        url: 'http://streams.example/alpha',
        group: 'Local',
      },
      Beta: {
        logo: 'http://images.example/beta.png',
      },
    });

    const channelMapYaml = await fs.readFile(path.join(configDir, 'channel-map.yaml'), 'utf8');
    expect(channelMapYaml).to.include('Alpha:');
    expect(channelMapYaml).to.include('number: "7.1"');
    expect(channelMapYaml).to.include('group: Local');
    expect(channelMapYaml).to.include('logo: http://images.example/beta.png');
  });
});
