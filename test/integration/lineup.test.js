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
        original_url: 'http://example.com/stream1'
      },
      {
        name: 'Test Channel Two',
        tvg_id: 'test.2',
        source: 'TestSource',
        logo: 'http://example.com/logo2.png',
        original_url: 'http://example.com/stream2'
      },
      {
        name: 'HLS Channel',
        tvg_id: 'hls.1',
        source: 'Tunarr',
        logo: 'http://example.com/logo3.png',
        original_url: 'http://tunarr.example/stream/channels/channel-1?streamMode=hls'
      },
      {
        name: 'WLNS-TV',
        tvg_id: '6.1',
        guideNumber: '6',
        source: 'Antenna',
        hdhomerun: { deviceID: '1234' },
        original_url: 'http://antenna.example/auto/v6.1'
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

  afterEach(() => {
    nock.cleanAll();
  });

  it('returns a valid M3U response for /lineup.m3u', async () => {
    const response = await axios.get(`${baseUrl}/lineup.m3u?include_unmapped=1`);
    const body = response.data;

    expect(response.status).to.equal(200);
    expect(body).to.include('#EXTM3U');
    expect(body).to.include('Test Channel One');
    expect(body).to.include('Test Channel Two');
    expect(body).to.include('tvg-id="test.1"');
    expect(body).to.include('tvg-id="test.2"');
    expect(body).to.include(`tvg-logo="${baseUrl}/images/TestSource/http%3A%2F%2Fexample.com%2Flogo1.png"`);
    expect(body).to.include('tvg-chno="6"');
  });

  it('excludes unmapped channels from /lineup.m3u by default', async () => {
    const response = await axios.get(`${baseUrl}/lineup.m3u`);
    const body = response.data;

    expect(response.status).to.equal(200);
    expect(body).to.not.include('Test Channel One');
    expect(body).to.not.include('Test Channel Two');
  });

  it('uses tvg_id as GuideNumber for HDHomeRun channels in /lineup.json', async () => {
    const response = await axios.get(`${baseUrl}/lineup.json?include_unmapped=1`);
    expect(response.status).to.equal(200);

    const wlns = response.data.find(ch => ch.GuideName === 'WLNS-TV');
    expect(wlns).to.exist;
    expect(wlns.GuideNumber).to.equal('6.1');
  });

  it('requests HDHomeRun streams in HLS mode and rewrites playlist URIs', async () => {
    nock('http://antenna.example')
      .get('/auto/v6.1')
      .query({ streamMode: 'hls' })
      .reply(
        200,
        '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n/auto/v6.1/hls/seg000001.ts\n',
        { 'Content-Type': 'application/vnd.apple.mpegurl' }
      );

    const playlistResponse = await axios.get(`${baseUrl}/stream/Antenna/WLNS-TV`);
    const playlistBody = playlistResponse.data;

    expect(playlistResponse.status).to.equal(200);
    expect(playlistBody).to.include('#EXTM3U');
    expect(playlistBody).to.include('/stream/Antenna/WLNS-TV?upstream=');
    expect(playlistBody).not.to.include('\n/auto/v6.1/hls/seg000001.ts\n');
  });

  it('pipes MPEG-TS directly when HDHomeRun returns video/mp2t with 200 for streamMode=hls', async () => {
    // Some HDHomeRun models return raw MPEG-TS with HTTP 200 instead of 503 when HLS is
    // unsupported. The proxy must NOT try to buffer and rewrite this as an HLS playlist
    // (which would hang forever on a live stream); it must pipe the bytes straight through.
    nock('http://antenna.example')
      .get('/auto/v6.1')
      .query({ streamMode: 'hls' })
      .reply(200, 'mpegts-bytes', { 'Content-Type': 'video/mp2t' });

    const streamResponse = await axios.get(`${baseUrl}/stream/Antenna/WLNS-TV`, {
      responseType: 'arraybuffer'
    });

    expect(streamResponse.status).to.equal(200);
    // Content-type must be forwarded as-is, NOT overwritten with application/x-mpegURL
    expect(streamResponse.headers['content-type']).to.include('video/mp2t');
    expect(Buffer.from(streamResponse.data).toString()).to.equal('mpegts-bytes');
  });

  it('falls back to MPEG-TS when HDHomeRun HLS mode returns 503', async () => {
    nock('http://antenna.example')
      .get('/auto/v6.1')
      .query({ streamMode: 'hls' })
      .reply(503, 'Service Unavailable');

    nock('http://antenna.example')
      .get('/auto/v6.1')
      .reply(200, 'mpegts-bytes', { 'Content-Type': 'video/mp2t' });

    const streamResponse = await axios.get(`${baseUrl}/stream/Antenna/WLNS-TV`, {
      responseType: 'arraybuffer'
    });

    expect(streamResponse.status).to.equal(200);
    expect(streamResponse.headers['content-type']).to.include('video/mp2t');
    expect(Buffer.from(streamResponse.data).toString()).to.equal('mpegts-bytes');
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

  it('rejects ?upstream= URLs pointing to a different origin (SSRF protection)', async () => {
    const maliciousUrl = encodeURIComponent('http://internal-server.local/secret');
    const response = await axios.get(`${baseUrl}/stream/Antenna/WLNS-TV?upstream=${maliciousUrl}`, {
      validateStatus: () => true
    });
    expect(response.status).to.equal(403);
  });

  it('allows ?upstream= URLs on the same origin as the channel', async () => {
    nock('http://antenna.example')
      .get('/auto/v6.1/hls/seg000001.ts')
      .reply(200, 'mpegts-bytes', { 'Content-Type': 'video/mp2t' });

    const segmentUrl = encodeURIComponent('http://antenna.example/auto/v6.1/hls/seg000001.ts');
    const response = await axios.get(`${baseUrl}/stream/Antenna/WLNS-TV?upstream=${segmentUrl}`, {
      responseType: 'arraybuffer'
    });
    expect(response.status).to.equal(200);
  });

  it('treats http://host and http://host:80 as the same origin (default port normalization)', async () => {
    nock('http://antenna.example')
      .get('/auto/v6.1/hls/seg000002.ts')
      .reply(200, 'mpegts-bytes2', { 'Content-Type': 'video/mp2t' });

    // antenna.example channel has original_url without an explicit port (default http:80).
    // A ?upstream= with the explicit :80 port should be treated as the same origin.
    const segmentUrl = encodeURIComponent('http://antenna.example:80/auto/v6.1/hls/seg000002.ts');
    const response = await axios.get(`${baseUrl}/stream/Antenna/WLNS-TV?upstream=${segmentUrl}`, {
      responseType: 'arraybuffer'
    });
    expect(response.status).to.equal(200);
  });
});
