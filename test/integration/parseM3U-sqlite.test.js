import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';

describe('parseAll SQLite persistence', () => {
  let configDir;
  let dataDir;
  let parseM3UModule;
  let databaseModule;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-parse-config-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-parse-data-'));

    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;

    await fs.writeFile(
      path.join(configDir, 'providers.yaml'),
      [
        'providers:',
        '  - name: Test IPTV',
        '    url: "http://parser.example/playlist.m3u"',
        '    type: "m3u"',
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(path.join(configDir, 'channel-map.yaml'), '{}\n', 'utf8');

    parseM3UModule = await import(`../../scripts/parseM3U.js?test=${Date.now()}`);
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

  it('persists discovered source channels and a successful sync run', async () => {
    nock('http://parser.example')
      .get('/playlist.m3u')
      .reply(
        200,
        [
          '#EXTM3U',
          '#EXTINF:-1 tvg-id="test.1" tvg-chno="101" tvg-logo="http://logos.example/one.png" group-title="News",Channel One',
          'http://streams.example/one.m3u8',
          '#EXTINF:-1 tvg-id="test.2" tvg-chno="202" group-title="Sports",Channel Two',
          'http://streams.example/two.m3u8',
        ].join('\n'),
        { 'Content-Type': 'application/x-mpegurl' }
      );

    const count = await parseM3UModule.parseAll();
    expect(count).to.equal(2);

    const source = databaseModule.get('SELECT id, name FROM sources WHERE name = ?', ['Test IPTV']);
    expect(source).to.not.equal(undefined);

    const discovered = databaseModule.all(
      'SELECT name, tvg_id, guide_number, group_name, stream_url FROM source_channels WHERE source_id = ? ORDER BY name ASC',
      [source.id]
    );
    expect(discovered).to.deep.equal([
      {
        name: 'Channel One',
        tvg_id: 'test.1',
        guide_number: '101',
        group_name: 'News',
        stream_url: 'http://streams.example/one.m3u8',
      },
      {
        name: 'Channel Two',
        tvg_id: 'test.2',
        guide_number: '202',
        group_name: 'Sports',
        stream_url: 'http://streams.example/two.m3u8',
      },
    ]);

    const syncRun = databaseModule.get(
      'SELECT kind, status, error FROM source_sync_runs WHERE source_id = ? ORDER BY started_at DESC LIMIT 1',
      [source.id]
    );
    expect(syncRun).to.deep.equal({
      kind: 'channels',
      status: 'success',
      error: null,
    });
  });

  it('does not promote HDHomeRun tuning numbers into guide_number', async () => {
    await fs.writeFile(
      path.join(configDir, 'providers.yaml'),
      [
        'providers:',
        '  - name: OTA',
        '    url: "http://hdhr.example"',
        '    type: "hdhomerun"',
      ].join('\n'),
      'utf8'
    );

    nock('http://hdhr.example')
      .get('/discover.json')
      .reply(200, {
        DeviceID: '12345678',
        BaseURL: 'http://hdhr.example',
        ModelNumber: 'HDHR5',
      });
    nock('http://hdhr.example')
      .get('/lineup.json')
      .reply(200, [
        {
          GuideName: 'WLNS-TV',
          GuideNumber: '6.1',
          URL: 'http://hdhr.example/auto/v6.1',
        },
      ]);

    const count = await parseM3UModule.parseAll();
    expect(count).to.equal(1);

    const source = databaseModule.get('SELECT id FROM sources WHERE name = ?', ['OTA']);
    const discovered = databaseModule.get(
      'SELECT name, guide_number, raw_json FROM source_channels WHERE source_id = ?',
      [source.id]
    );

    expect(discovered.name).to.equal('WLNS-TV');
    expect(discovered.guide_number).to.equal(null);
    expect(JSON.parse(discovered.raw_json)).to.include({
      sourceGuideNumber: '6.1',
    });
  });
});
