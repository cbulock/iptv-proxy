import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';

describe('app settings service', () => {
  let configDir;
  let dataDir;
  let appSettingsService;
  let databaseModule;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-app-settings-config-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-app-settings-data-'));

    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;

    await fs.writeFile(
      path.join(configDir, 'app.yaml'),
      [
        'base_url: "https://example.com"',
        'cache:',
        '  epg_ttl: 123',
        'webhooks:',
        '  - url: "https://hooks.example/channels"',
        '    events:',
        '      - "channels.refreshed"',
      ].join('\n'),
      'utf8'
    );

    appSettingsService = await import(`../../libs/app-settings-service.js?test=${Date.now()}`);
    databaseModule = await import('../../libs/database.js');
  });

  afterEach(async () => {
    databaseModule.closeDatabase();
    delete process.env.CONFIG_PATH;
    delete process.env.DATA_PATH;
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('seeds app settings from app.yaml when the database is empty', () => {
    expect(appSettingsService.loadAppConfigFromStore()).to.deep.equal({
      base_url: 'https://example.com',
      cache: {
        epg_ttl: 123,
      },
      webhooks: [
        {
          url: 'https://hooks.example/channels',
          events: ['channels.refreshed'],
        },
      ],
    });
  });

  it('replaces stored app settings and exports the compatibility app.yaml file', async () => {
    appSettingsService.replaceAppConfig({
      base_url: 'https://updated.example.com',
      cache: {
        m3u_ttl: 600,
      },
      admin_auth: {
        username: 'admin',
        password: '$2b$10$examplehashvalueexamplehashvalueexamplehashvalue12',
      },
    });

    expect(appSettingsService.loadAppConfigFromStore()).to.deep.equal({
      base_url: 'https://updated.example.com',
      cache: {
        m3u_ttl: 600,
      },
      admin_auth: {
        username: 'admin',
        password: '$2b$10$examplehashvalueexamplehashvalueexamplehashvalue12',
      },
    });

    const appYaml = await fs.readFile(path.join(configDir, 'app.yaml'), 'utf8');
    expect(appYaml).to.include('base_url: https://updated.example.com');
    expect(appYaml).to.include('m3u_ttl: 600');
    expect(appYaml).to.include('username: admin');
  });
});
