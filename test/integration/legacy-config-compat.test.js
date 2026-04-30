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

describe('legacy config compatibility routes', () => {
  let configDir;
  let dataDir;
  let server;
  let baseUrl;
  let databaseModule;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-legacy-config-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-legacy-data-'));

    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;

    await fs.writeFile(
      path.join(configDir, 'providers.yaml'),
      [
        'providers:',
        '  - name: Source One',
        '    url: "http://example.com/one.m3u"',
        '    type: "m3u"',
        '    epg: "http://example.com/one.xml"',
        '  - name: Source Two',
        '    url: "http://example.com/two.m3u"',
        '    type: "hdhomerun"',
      ].join('\n'),
      'utf8'
    );

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { authenticated: true };
      next();
    });

    const configRouter = (await import(`../../server/config.js?test=${Date.now()}`)).default;
    app.use(configRouter);

    ({ server, baseUrl } = await startServer(app));
    databaseModule = await import('../../libs/database.js');
  });

  afterEach(async () => {
    if (server) {
      await stopServer(server);
    }
    databaseModule.closeDatabase();
    delete process.env.CONFIG_PATH;
    delete process.env.DATA_PATH;
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('synthesizes /api/config/m3u and /api/config/epg from the source store', async () => {
    const [m3uResponse, epgResponse] = await Promise.all([
      axios.get(`${baseUrl}/api/config/m3u`),
      axios.get(`${baseUrl}/api/config/epg`),
    ]);

    expect(m3uResponse.status).to.equal(200);
    expect(m3uResponse.data).to.deep.equal({
      urls: [
        {
          name: 'Source One',
          url: 'http://example.com/one.m3u',
          type: 'm3u',
        },
        {
          name: 'Source Two',
          url: 'http://example.com/two.m3u',
          type: 'hdhomerun',
        },
      ],
    });

    expect(epgResponse.status).to.equal(200);
    expect(epgResponse.data).to.deep.equal({
      urls: [
        {
          name: 'Source One',
          url: 'http://example.com/one.xml',
        },
      ],
    });
  });

  it('updates provider-backed source state through the legacy compatibility endpoints', async () => {
    const m3uUpdate = {
      urls: [
        {
          name: 'Source One',
          url: 'http://updated.example/one.m3u',
          type: 'm3u',
        },
        {
          name: 'Source Three',
          url: 'http://updated.example/three.m3u',
          type: 'm3u',
        },
      ],
    };

    const epgUpdate = {
      urls: [
        {
          name: 'Source One',
          url: 'http://updated.example/one.xml',
        },
        {
          name: 'Source Three',
          url: 'http://updated.example/three.xml',
        },
      ],
    };

    const m3uResponse = await axios.put(`${baseUrl}/api/config/m3u`, m3uUpdate);
    expect(m3uResponse.status).to.equal(200);

    const epgResponse = await axios.put(`${baseUrl}/api/config/epg`, epgUpdate);
    expect(epgResponse.status).to.equal(200);

    const providersResponse = await axios.get(`${baseUrl}/api/config/providers`);
    expect(providersResponse.data).to.deep.equal({
      providers: [
        {
          name: 'Source One',
          url: 'http://updated.example/one.m3u',
          type: 'm3u',
          epg: 'http://updated.example/one.xml',
        },
        {
          name: 'Source Three',
          url: 'http://updated.example/three.m3u',
          type: 'm3u',
          epg: 'http://updated.example/three.xml',
        },
      ],
    });
  });

  it('rejects legacy EPG updates for unknown source names', async () => {
    try {
      await axios.put(`${baseUrl}/api/config/epg`, {
        urls: [{ name: 'Unknown Source', url: 'http://example.com/unknown.xml' }],
      });
      expect.fail('Expected EPG compatibility update to fail');
    } catch (err) {
      expect(err.response.status).to.equal(400);
      expect(err.response.data.error).to.equal('Failed to save EPG compatibility view');
      expect(err.response.data.detail).to.include('Unknown source');
    }
  });
});
