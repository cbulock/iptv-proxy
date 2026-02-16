import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs/promises';
import axios from 'axios';
import path from 'path';
import nock from 'nock';
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
    await fs.mkdir(path.dirname(channelsFile), { recursive: true });

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
        original_url: 'http://example.com/stream1',
      },
      {
        name: 'Test Channel Two',
        tvg_id: 'test.2',
        source: 'TestSource',
        logo: 'http://example.com/logo2.png',
        original_url: 'http://example.com/stream2',
      },
      {
        name: 'HLS Channel',
        tvg_id: 'hls.1',
        source: 'Tunarr',
        logo: 'http://example.com/logo3.png',
        original_url: 'http://tunarr.example/stream/channels/channel-1?streamMode=hls',
      },
      {
        name: 'WLNS-TV',
        tvg_id: '6.1',
        guideNumber: '6',
        source: 'Antenna',
        hdhomerun: { deviceID: '1234' },
        original_url: 'http://antenna.example/auto/v6.1',
      },
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

  afterEach(() => {
    nock.cleanAll();
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

  it('uses tvg_id as GuideNumber for HDHomeRun channels in /lineup.json', async () => {
    const response = await axios.get(`${baseUrl}/lineup.json`);
    expect(response.status).to.equal(200);

    const wlns = response.data.find(ch => ch.GuideName === 'WLNS-TV');
    expect(wlns).to.exist;
    expect(wlns.GuideNumber).to.equal('6.1');
  });

  it('rewrites HLS playlist URIs to proxy stream URLs', async () => {
    nock('http://tunarr.example')
      .get('/stream/channels/channel-1')
      .query({ streamMode: 'hls' })
      .reply(
        200,
        '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n/stream/channels/channel-1/hls/data000004.ts\n',
        { 'Content-Type': 'application/vnd.apple.mpegurl' }
      );

    const playlistResponse = await axios.get(`${baseUrl}/stream/Tunarr/HLS%20Channel`);
    const playlistBody = playlistResponse.data;

    expect(playlistResponse.status).to.equal(200);
    expect(playlistBody).to.include('#EXTM3U');
    expect(playlistBody).to.include('/stream/Tunarr/HLS%20Channel?upstream=');
    expect(playlistBody).not.to.include('\n/stream/channels/channel-1/hls/data000004.ts\n');

    const proxiedSegmentUrl = playlistBody
      .split('\n')
      .find(line => line.includes('/stream/Tunarr/HLS%20Channel?upstream='));
    expect(proxiedSegmentUrl).to.be.a('string');

    nock('http://tunarr.example')
      .get('/stream/channels/channel-1/hls/data000004.ts')
      .reply(200, 'segment-bytes', { 'Content-Type': 'video/mp2t' });

    const segmentResponse = await axios.get(proxiedSegmentUrl);
    expect(segmentResponse.status).to.equal(200);
    expect(segmentResponse.data).to.equal('segment-bytes');
  });
});
