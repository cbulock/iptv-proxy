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

describe('channel map SQLite-backed routes', () => {
  let configDir;
  let dataDir;
  let server;
  let baseUrl;
  let databaseModule;
  let channelMapService;
  let authModule;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-channel-map-routes-config-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-channel-map-routes-data-'));

    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;

    await fs.writeFile(path.join(configDir, 'app.yaml'), '{}\n', 'utf8');
    await fs.writeFile(path.join(configDir, 'providers.yaml'), 'providers: []\n', 'utf8');
    await fs.writeFile(
      path.join(configDir, 'channel-map.yaml'),
      [
        '"Source Alpha":',
        '  name: "Alpha"',
        '  number: "101"',
        '"Source Beta":',
        '  tvg_id: "beta.id"',
      ].join('\n') + '\n',
      'utf8'
    );

    authModule = await import(`../../server/auth.js?test=${Date.now()}`);
    authModule.invalidateAuthCache();

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { authenticated: true };
      next();
    });

    const configRouter = (await import(`../../server/config.js?test=${Date.now()}`)).default;
    const channelsRouter = (await import(`../../server/channels-management.js?test=${Date.now()}`))
      .default;

    app.use(configRouter);
    app.use('/api/channels', channelsRouter);

    ({ server, baseUrl } = await startServer(app));

    channelMapService = await import(`../../libs/channel-map-service.js?test=${Date.now()}`);
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

  it('reads and replaces the channel map through the SQLite-backed config endpoint', async () => {
    const initialResponse = await axios.get(`${baseUrl}/api/config/channel-map`);
    expect(initialResponse.data).to.deep.equal({
      'Source Alpha': {
        name: 'Alpha',
        number: '101',
      },
      'Source Beta': {
        tvg_id: 'beta.id',
      },
    });

    const replacement = {
      'Source Gamma': {
        name: 'Gamma',
        number: '303',
        group: 'Sports',
      },
    };

    const saveResponse = await axios.put(`${baseUrl}/api/config/channel-map`, replacement);
    expect(saveResponse.status).to.equal(200);
    expect(saveResponse.data).to.deep.equal({ status: 'saved' });

    expect(channelMapService.loadChannelMapFromStore()).to.deep.equal(replacement);

    const yamlText = await fs.readFile(path.join(configDir, 'channel-map.yaml'), 'utf8');
    expect(yamlText).to.include('Source Gamma:');
    expect(yamlText).to.include('group: Sports');
  });

  it('persists mapping CRUD endpoints through the SQLite-backed store', async () => {
    const saveResponse = await axios.post(`${baseUrl}/api/mapping`, {
      key: 'Source Alpha',
      mapping: {
        logo: 'http://images.example/alpha.png',
        group: 'Local',
      },
    });

    expect(saveResponse.status).to.equal(200);
    expect(saveResponse.data.mapping).to.deep.equal({
      name: 'Alpha',
      number: '101',
      logo: 'http://images.example/alpha.png',
      group: 'Local',
    });

    const bulkResponse = await axios.post(`${baseUrl}/api/mapping/bulk`, {
      mappings: {
        'Source Delta': {
          name: 'Delta',
          tvg_id: 'delta.id',
        },
        'Source Beta': {
          number: '202',
        },
      },
    });

    expect(bulkResponse.status).to.equal(200);
    expect(bulkResponse.data).to.deep.equal({ status: 'saved', count: 2 });

    const deleteResponse = await axios.delete(`${baseUrl}/api/mapping/${encodeURIComponent('Source Beta')}`);
    expect(deleteResponse.status).to.equal(200);
    expect(deleteResponse.data).to.deep.equal({ status: 'deleted', key: 'Source Beta' });

    expect(channelMapService.loadChannelMapFromStore()).to.deep.equal({
      'Source Alpha': {
        name: 'Alpha',
        number: '101',
        logo: 'http://images.example/alpha.png',
        group: 'Local',
      },
      'Source Delta': {
        name: 'Delta',
        tvg_id: 'delta.id',
      },
    });
  });

  it('persists channel management updates through the SQLite-backed mapping store', async () => {
    const reorderResponse = await axios.post(`${baseUrl}/api/channels/reorder`, {
      channels: [{ name: 'Source Alpha', number: '111' }],
    });
    expect(reorderResponse.data.updated).to.equal(1);

    const renameResponse = await axios.post(`${baseUrl}/api/channels/rename`, {
      channels: [{ oldName: 'Source Alpha', newName: 'Alpha Prime' }],
    });
    expect(renameResponse.data.updated).to.equal(1);

    const groupResponse = await axios.post(`${baseUrl}/api/channels/group`, {
      channels: [{ name: 'Alpha Prime', group: 'Favorites' }],
    });
    expect(groupResponse.data.updated).to.equal(1);

    const bulkResponse = await axios.post(`${baseUrl}/api/channels/bulk-update`, {
      channels: [
        { name: 'Alpha Prime', newName: 'Alpha Final', number: '222', group: 'News' },
        { name: 'Source Beta', group: 'Kids' },
      ],
    });
    expect(bulkResponse.data.updated).to.equal(2);

    expect(channelMapService.loadChannelMapFromStore()).to.deep.equal({
      'Alpha Final': {
        name: 'Alpha Final',
        number: '222',
        group: 'News',
      },
      'Source Beta': {
        tvg_id: 'beta.id',
        group: 'Kids',
      },
    });

    const yamlText = await fs.readFile(path.join(configDir, 'channel-map.yaml'), 'utf8');
    expect(yamlText).to.include('Alpha Final:');
    expect(yamlText).to.include('number: "222"');
    expect(yamlText).to.include('group: News');
  });
});
