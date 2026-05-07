import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs/promises';
import axios from 'axios';
import path from 'path';
import os from 'os';
import nock from 'nock';

describe('Lineup Route Integration', () => {
  let configDir = '';
  let dataDir = '';
  let server = null;
  let baseUrl = '';
  let initChannelsCache;
  let cleanupCache;
  let replaceChannelSnapshot;
  let setupLineupRoutes;
  let errorHandler;
  let databaseModule;

  before(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-lineup-config-'));
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-lineup-data-'));
    process.env.CONFIG_PATH = configDir;
    process.env.DATA_PATH = dataDir;

    await fs.writeFile(path.join(configDir, 'app.yaml'), '{}\n', 'utf8');
    await fs.writeFile(path.join(configDir, 'channel-map.yaml'), '{}\n', 'utf8');

    const channelsCacheModule = await import('../../libs/channels-cache.js');
    const snapshotModule = await import('../../libs/channel-snapshot-service.js');
    const lineupModule = await import('../../server/lineup.js');
    const errorHandlerModule = await import('../../server/error-handler.js');
    databaseModule = await import('../../libs/database.js');

    initChannelsCache = channelsCacheModule.initChannelsCache;
    cleanupCache = channelsCacheModule.cleanupCache;
    replaceChannelSnapshot = snapshotModule.replaceChannelSnapshot;
    setupLineupRoutes = lineupModule.setupLineupRoutes;
    errorHandler = errorHandlerModule.errorHandler;

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
      {
        name: 'Redirect Channel',
        tvg_id: 'redirect.1',
        source: 'TunarrInternal',
        logo: 'http://example.com/logo4.png',
        original_url: 'http://tunarr-internal.example:8000/stream/channels/redirect-uuid',
      },
      {
        name: 'Octet Stream Channel',
        tvg_id: 'octet.1',
        source: 'OctetSource',
        original_url: 'http://octet.example/stream.m3u8',
      },
    ];

    replaceChannelSnapshot(testChannels);
    await initChannelsCache();

    const app = express();
    setupLineupRoutes(app, {});
    app.use(errorHandler);

    await new Promise(resolve => {
      server = app.listen(0, 'localhost', () => {
        const address = server.address();
        baseUrl = `http://localhost:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    cleanupCache();
    databaseModule.closeDatabase();
    delete process.env.CONFIG_PATH;
    delete process.env.DATA_PATH;
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
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
    expect(body).to.include(
      `tvg-logo="${baseUrl}/images/TestSource/http%3A%2F%2Fexample.com%2Flogo1.png"`
    );
    expect(body).to.include('tvg-chno="6"');
  });

  it('excludes unmapped channels from /lineup.m3u by default', async () => {
    const response = await axios.get(`${baseUrl}/lineup.m3u`);
    const body = response.data;

    expect(response.status).to.equal(200);
    expect(body).to.not.include('Test Channel One');
    expect(body).to.not.include('Test Channel Two');
  });

  it('uses guideNumber as GuideNumber for HDHomeRun channels in /lineup.json', async () => {
    const response = await axios.get(`${baseUrl}/lineup.json?include_unmapped=1`);
    expect(response.status).to.equal(200);

    const wlns = response.data.find(ch => ch.GuideName === 'WLNS-TV');
    expect(wlns).to.exist;
    // guideNumber ('6') must take precedence over tvg_id ('6.1')
    expect(wlns.GuideNumber).to.equal('6');
  });

  it('excludes unmapped HDHomeRun channels from /lineup.json without include_unmapped', async () => {
    // HDHomeRun channels must now be in the channel map to appear in the lineup,
    // the same as any other channel type.
    const response = await axios.get(`${baseUrl}/lineup.json`);
    expect(response.status).to.equal(200);

    const wlns = response.data.find(ch => ch.GuideName === 'WLNS-TV');
    expect(wlns).to.not.exist;
  });

  it('excludes unmapped HDHomeRun channels from /lineup.m3u without include_unmapped', async () => {
    // HDHomeRun channels must now be in the channel map to appear in the M3U
    // playlist, the same as any other channel type.
    const response = await axios.get(`${baseUrl}/lineup.m3u`);
    const body = response.data;

    expect(response.status).to.equal(200);
    expect(body).to.not.include('WLNS-TV');
  });

  it('proxies HDHomeRun MPEG-TS streams directly without adding ?streamMode=hls by default', async () => {
    // The proxy must NOT append ?streamMode=hls to HDHomeRun stream URLs for ordinary
    // requests.  Regular IPTV clients (Plex, Jellyfin, etc.) expect binary MPEG-TS data
    // and report "200 but no video" when they receive a text HLS playlist instead.
    nock('http://antenna.example')
      .get('/auto/v6.1')
      .query(query => !query.streamMode)
      .reply(200, 'mpegts-bytes', { 'Content-Type': 'video/mp2t' });

    const streamResponse = await axios.get(`${baseUrl}/stream/Antenna/WLNS-TV`, {
      responseType: 'arraybuffer',
    });

    expect(streamResponse.status).to.equal(200);
    expect(streamResponse.headers['content-type']).to.include('video/mp2t');
    expect(Buffer.from(streamResponse.data).toString()).to.equal('mpegts-bytes');
  });

  it('requests HLS from HDHomeRun and rewrites the playlist when ?streamMode=hls is in the client request', async () => {
    // Browser preview appends ?streamMode=hls to stream URLs for HDHomeRun channels.
    // OTA broadcasts use MPEG-2 video / AC-3 audio which browser MSE cannot decode;
    // requesting HLS makes the HDHomeRun transcode to browser-compatible H.264+AAC.
    nock('http://antenna.example')
      .get('/auto/v6.1')
      .query({ streamMode: 'hls' })
      .reply(
        200,
        '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n/auto/v6.1/hls/seg000001.ts\n',
        { 'Content-Type': 'application/vnd.apple.mpegurl' }
      );

    const playlistResponse = await axios.get(`${baseUrl}/stream/Antenna/WLNS-TV?streamMode=hls`);
    expect(playlistResponse.status).to.equal(200);
    expect(playlistResponse.data).to.include('#EXTM3U');
    expect(playlistResponse.data).to.include('/stream/Antenna/WLNS-TV?upstream=');
    expect(playlistResponse.data).not.to.include('\n/auto/v6.1/hls/seg000001.ts\n');
  });

  it('pipes HDHomeRun MPEG-TS directly when device ignores ?streamMode=hls (content-type video/mp2t)', async () => {
    // Some older HDHomeRun firmware may return raw MPEG-TS even when ?streamMode=hls is
    // requested.  The proxy must detect this via the explicit video/mp2t Content-Type and
    // pipe the stream through rather than trying to buffer it as an HLS playlist.
    nock('http://antenna.example')
      .get('/auto/v6.1')
      .query({ streamMode: 'hls' })
      .reply(200, 'mpegts-fallback', { 'Content-Type': 'video/mp2t' });

    const streamResponse = await axios.get(`${baseUrl}/stream/Antenna/WLNS-TV?streamMode=hls`, {
      responseType: 'arraybuffer'
    });

    expect(streamResponse.status).to.equal(200);
    expect(streamResponse.headers['content-type']).to.include('video/mp2t');
    expect(Buffer.from(streamResponse.data).toString()).to.equal('mpegts-fallback');
  });

  it('pipes HDHomeRun streams directly even when the device redirects to an .m3u8 URL', async () => {
    // Some HDHomeRun firmware versions redirect /auto/vX.Y to an .m3u8-named URL while
    // still streaming raw MPEG-TS data.  Without the !channel.hdhomerun guard,
    // isLikelyHlsPlaylist() sees the redirected URL ending in .m3u8 and returns true
    // via URL heuristics, readStreamToUtf8 buffers the stream, exceeds the 1 MB cap,
    // and the proxy returns 502 instead of piping the stream through.
    const bigPayload = Buffer.alloc(Math.ceil(1.1 * 1024 * 1024), 0xff); // > 1 MB MPEG-TS

    // Simulate firmware redirect: /auto/v6.1 → /auto/v6.1.m3u8 (same origin).
    nock('http://antenna.example')
      .get('/auto/v6.1')
      .query(query => !query.streamMode)
      .reply(302, '', { Location: 'http://antenna.example/auto/v6.1.m3u8' });

    // The redirected URL has no content-type, so isLikelyHlsPlaylist() falls back to
    // the URL heuristic (.m3u8 suffix → true) and would hit the 1 MB buffer cap.
    nock('http://antenna.example').get('/auto/v6.1.m3u8').reply(200, bigPayload, {});

    const response = await axios.get(`${baseUrl}/stream/Antenna/WLNS-TV`, {
      validateStatus: () => true,
      responseType: 'arraybuffer',
    });

    // Must NOT be 502 — the !channel.hdhomerun guard bypasses HLS buffering entirely.
    expect(response.status).to.equal(200);
    expect(Buffer.from(response.data).length).to.equal(bigPayload.length);
  });

  it('returns 502 when a generic content-type response exceeds the 1 MB playlist size cap', async () => {
    // When content-type is absent or generic (e.g. application/octet-stream) the proxy falls
    // back to URL-based heuristics and may attempt to buffer the response as an HLS playlist.
    // If the stream exceeds 1 MB the proxy must abort and return 502 instead of hanging.
    const bigPayload = Buffer.alloc(1.1 * 1024 * 1024, 0xff); // 1.1 MB of binary data

    nock('http://octet.example')
      .get('/stream.m3u8')
      .reply(200, bigPayload, { 'Content-Type': 'application/octet-stream' });

    const response = await axios.get(`${baseUrl}/stream/OctetSource/Octet%20Stream%20Channel`, {
      validateStatus: () => true,
    });

    expect(response.status).to.equal(502);
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
      validateStatus: () => true,
    });
    expect(response.status).to.equal(403);
  });

  it('allows ?upstream= URLs on the same origin as the channel', async () => {
    nock('http://antenna.example')
      .get('/auto/v6.1/hls/seg000001.ts')
      .reply(200, 'mpegts-bytes', { 'Content-Type': 'video/mp2t' });

    const segmentUrl = encodeURIComponent('http://antenna.example/auto/v6.1/hls/seg000001.ts');
    const response = await axios.get(`${baseUrl}/stream/Antenna/WLNS-TV?upstream=${segmentUrl}`, {
      responseType: 'arraybuffer',
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
      responseType: 'arraybuffer',
    });
    expect(response.status).to.equal(200);
  });

  it('allows segment requests after manifest redirect to different origin', async () => {
    // Verify that ?upstream= segment validation works when the channel's original_url
    // redirects to a different origin (e.g., internal HTTP → external HTTPS via reverse proxy).
    nock('http://tunarr-internal.example:8000')
      .get('/stream/channels/redirect-uuid')
      .reply(302, '', {
        Location: 'https://tunarr-external.example/stream/channels/redirect-uuid',
      });

    nock('https://tunarr-external.example')
      .get('/stream/channels/redirect-uuid')
      .reply(
        200,
        '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n/stream/channels/redirect-uuid/hls/data000000.ts\n',
        { 'Content-Type': 'application/vnd.apple.mpegurl' }
      );

    // Step 1: fetch the manifest via the proxy. The proxy follows the redirect internally
    // and caches the redirected origin for subsequent ?upstream= validation.
    const manifestResponse = await axios.get(`${baseUrl}/stream/TunarrInternal/Redirect%20Channel`);
    expect(manifestResponse.status).to.equal(200);
    expect(manifestResponse.data).to.include('/stream/TunarrInternal/Redirect%20Channel?upstream=');

    // The rewritten segment URL must reference the redirected origin.
    // rewriteUriToProxy produces absolute URLs (it includes getBaseUrl(req) as the prefix).
    const segmentLine = manifestResponse.data.split('\n').find(l => l.includes('?upstream='));
    expect(segmentLine).to.be.a('string');
    expect(decodeURIComponent(segmentLine)).to.include('tunarr-external.example');

    // Step 2: request the rewritten segment URL. Without the fix this would return 403
    // because "tunarr-external.example" doesn't match the origin in channel.original_url
    // ("tunarr-internal.example:8000").
    nock('https://tunarr-external.example')
      .get('/stream/channels/redirect-uuid/hls/data000000.ts')
      .reply(200, 'segment-bytes', { 'Content-Type': 'video/mp2t' });

    // segmentLine is already an absolute URL produced by rewriteUriToProxy
    const segmentResponse = await axios.get(segmentLine, {
      responseType: 'arraybuffer',
    });
    expect(segmentResponse.status).to.equal(200);
    expect(Buffer.from(segmentResponse.data).toString()).to.equal('segment-bytes');
  });
});
