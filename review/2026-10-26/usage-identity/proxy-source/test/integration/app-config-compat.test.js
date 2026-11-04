import { afterEach, beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';
import axios from 'axios';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

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

describe('app config SQLite compatibility routes', () => {
  let configDir;
  let dataDir;
  let server;
  let baseUrl;
  let databaseModule;
  let appSettingsService;
  let authModule;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-app-config-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-app-data-'));

    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;

    await fs.writeFile(
      path.join(configDir, 'app.yaml'),
      [
        'base_url: "https://seed.example.com"',
        'cache:',
        '  epg_ttl: 900',
        'admin_auth:',
        '  username: "admin"',
        '  password: "$2b$10$seededseededseededseededseededseededseededseeded12"',
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(path.join(configDir, 'providers.yaml'), 'providers: []\n', 'utf8');

    authModule = await import(`../../server/auth.js?test=${Date.now()}`);
    authModule.invalidateAuthCache();

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { authenticated: true };
      next();
    });

    const configRouter = (await import(`../../server/config.js?test=${Date.now()}`)).default;
    app.use(configRouter);

    ({ server, baseUrl } = await startServer(app));

    appSettingsService = await import(`../../libs/app-settings-service.js?test=${Date.now()}`);
    databaseModule = await import('../../libs/database.js');
  });

  afterEach(async () => {
    if (server) {
      await stopServer(server);
    }
    databaseModule.closeDatabase();
    authModule.invalidateAuthCache();
    delete process.env.CONFIG_PATH;
    delete process.env.DATA_PATH;
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('reads app config from the SQLite-backed store', async () => {
    const response = await axios.get(`${baseUrl}/api/config/app`);

    expect(response.status).to.equal(200);
    expect(response.data).to.deep.equal({
      base_url: 'https://seed.example.com',
      cache: {
        epg_ttl: 900,
      },
      admin_auth: {
        username: 'admin',
        password: '$2b$10$seededseededseededseededseededseededseededseeded12',
      },
    });
  });

  it('writes app config through SQLite while preserving admin_auth compatibility data', async () => {
    const update = {
      base_url: 'https://updated.example.com',
      cache: {
        epg_ttl: 1200,
        m3u_ttl: 300,
      },
      webhooks: [
        {
          url: 'https://hooks.example.com/channel-refresh',
          events: ['channels.refreshed'],
        },
      ],
    };

    const response = await axios.put(`${baseUrl}/api/config/app`, update);
    expect(response.status).to.equal(200);
    expect(response.data).to.deep.equal({ status: 'saved' });

    expect(appSettingsService.loadAppConfigFromStore()).to.deep.equal({
      ...update,
      admin_auth: {
        username: 'admin',
        password: '$2b$10$seededseededseededseededseededseededseededseeded12',
      },
    });

    const appYaml = await fs.readFile(path.join(configDir, 'app.yaml'), 'utf8');
    expect(appYaml).to.include('base_url: https://updated.example.com');
    expect(appYaml).to.include('m3u_ttl: 300');
    expect(appYaml).to.include('username: admin');
  });
});
