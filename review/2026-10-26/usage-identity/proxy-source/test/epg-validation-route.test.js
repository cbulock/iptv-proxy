import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { initChannelsCache, cleanupCache } from '../libs/channels-cache.js';
import { replaceChannelSnapshot } from '../libs/channel-snapshot-service.js';

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

function buildXmltv(channelId, title) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="${channelId}">
    <display-name>${title}</display-name>
  </channel>
  <programme channel="${channelId}" start="20260101000000 +0000" stop="20260101010000 +0000">
    <title>${title} Show</title>
  </programme>
</tv>`;
}

describe('GET /api/epg/validate', () => {
  let tmpConfigDir;
  let tmpDataDir;
  let server;
  let baseUrl;

  before(async () => {
    tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-epg-validation-data-'));
    tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-epg-validation-config-'));
    process.env.DATA_PATH = tmpDataDir;
    process.env.CONFIG_PATH = tmpConfigDir;

    const validEpgPath = path.join(tmpConfigDir, 'valid-epg.xml');
    const missingEpgPath = path.join(tmpConfigDir, 'missing-epg.xml');

    replaceChannelSnapshot([{ name: 'Good Channel', tvg_id: 'good.1', source: 'Good Provider' }]);
    await initChannelsCache();

    await fs.writeFile(validEpgPath, buildXmltv('good.1', 'Good Channel'), 'utf8');
    await fs.writeFile(
      path.join(tmpConfigDir, 'providers.yaml'),
      [
        'providers:',
        '  - name: Good Provider',
        '    url: "http://placeholder-good"',
        `    epg: "${pathToFileURL(validEpgPath).href}"`,
        '  - name: Broken Provider',
        '    url: "http://placeholder-bad"',
        `    epg: "${pathToFileURL(missingEpgPath).href}"`,
        '',
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(path.join(tmpConfigDir, 'app.yaml'), '{}\n', 'utf8');

    const app = express();
    app.use(express.json());

    const epgModule = await import(`../server/epg.js?test=${Date.now()}`);
    const errorHandlerModule = await import(`../server/error-handler.js?test=${Date.now()}`);

    await epgModule.setupEPGRoutes(app);
    app.use(errorHandlerModule.errorHandler);

    ({ server, baseUrl } = await startServer(app));
  });

  after(async () => {
    if (server) {
      await stopServer(server);
    }

    await cleanupCache();
    const { closeDatabase } = await import('../libs/database.js');
    closeDatabase();
    await fs.rm(tmpDataDir, { recursive: true, force: true });
    await fs.rm(tmpConfigDir, { recursive: true, force: true });
    delete process.env.DATA_PATH;
    delete process.env.CONFIG_PATH;
  });

  it('includes the failed EPG source in validation results', async () => {
    const response = await axios.get(`${baseUrl}/api/epg/validate`);
    const brokenSource = response.data.sources.results.find(
      source => source.source === 'Broken Provider'
    );

    expect(response.status).to.equal(200);
    expect(response.data.valid).to.equal(false);
    expect(response.data.errors.some(error => error.includes('Broken Provider'))).to.equal(true);
    expect(response.data.sources).to.deep.include({
      total: 2,
      valid: 1,
      failed: 1,
    });
    expect(brokenSource).to.include({
      source: 'Broken Provider',
      url: pathToFileURL(path.join(tmpConfigDir, 'missing-epg.xml')).href,
      status: 'error',
    });
    expect(brokenSource.error).to.include('Failed to read file:');
  });
});
