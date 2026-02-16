import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs/promises';
import axios from 'axios';
import { getDataPath } from '../../libs/paths.js';
import { initChannelsCache, cleanupCache } from '../../libs/channels-cache.js';
import { setupLineupRoutes } from '../../server/lineup.js';
import { errorHandler } from '../../server/error-handler.js';

describe('Lineup Route Integration', () => {
  const channelsFile = getDataPath('channels.json');
  let originalChannels = null;
  let hadOriginalChannelsFile = false;
  let server = null;
  let baseUrl = '';

  before(async () => {
    try {
      originalChannels = await fs.readFile(channelsFile, 'utf8');
      hadOriginalChannelsFile = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const testChannels = [
      {
        name: 'Test Channel One',
        tvg_id: 'test.1',
        source: 'TestSource',
        logo: 'http://example.com/logo1.png',
        original_url: 'http://example.com/stream1'
      },
      {
        name: 'Test Channel Two',
        tvg_id: 'test.2',
        source: 'TestSource',
        logo: 'http://example.com/logo2.png',
        original_url: 'http://example.com/stream2'
      }
    ];

    await fs.writeFile(channelsFile, JSON.stringify(testChannels), 'utf8');
    await initChannelsCache();

    const app = express();
    setupLineupRoutes(app, {});
    app.use(errorHandler);

    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    cleanupCache();

    if (hadOriginalChannelsFile && originalChannels !== null) {
      await fs.writeFile(channelsFile, originalChannels, 'utf8');
    } else {
      try {
        await fs.unlink(channelsFile);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  });

  it('returns a valid M3U response for /lineup.m3u', async () => {
    const response = await axios.get(`${baseUrl}/lineup.m3u`);
    const body = response.data;

    expect(response.status).to.equal(200);
    expect(body).to.include('#EXTM3U');
    expect(body).to.include('Test Channel One');
    expect(body).to.include('Test Channel Two');
    expect(body).to.include('tvg-id="test.1"');
    expect(body).to.include('tvg-id="test.2"');
  });
});
