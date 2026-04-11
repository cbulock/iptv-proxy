import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import nock from 'nock';
import { getDataPath } from '../../libs/paths.js';
import { initChannelsCache, cleanupCache } from '../../libs/channels-cache.js';
import { setupStreamProbeRoutes, parseMpegTsCodecs } from '../../server/stream-probe.js';
import { errorHandler } from '../../server/error-handler.js';
import { invalidateAuthCache } from '../../server/auth.js';

// ---------------------------------------------------------------------------
// MPEG-TS test data builders
// ---------------------------------------------------------------------------

const TS_PACKET_SIZE = 188;

/**
 * Build a single 188-byte MPEG-TS packet carrying the given payload.
 * @param {number} pid
 * @param {boolean} pusi - Payload Unit Start Indicator
 * @param {Buffer} payload - section bytes (including pointer field when pusi=true)
 * @returns {Buffer}
 */
function buildTsPacket(pid, pusi, payload) {
  const packet = Buffer.alloc(TS_PACKET_SIZE, 0xff);
  packet[0] = 0x47; // sync
  packet[1] = (pusi ? 0x40 : 0x00) | ((pid >> 8) & 0x1f);
  packet[2] = pid & 0xff;
  packet[3] = 0x10; // payload only, continuity counter 0
  payload.copy(packet, 4);
  return packet;
}

/**
 * Build a PAT section pointing a single program at the given PMT PID.
 * @param {number} pmtPid
 * @returns {Buffer} section bytes (starting with pointer_field = 0x00)
 */
function buildPATSection(pmtPid) {
  // section_length = transport_stream_id(2) + version(1) + section/last(2) +
  //                  program entry(4) + CRC32(4) = 13
  return Buffer.from([
    0x00, // pointer_field
    0x00, // table_id = PAT
    0xb0,
    0x0d, // section_syntax_indicator | reserved | section_length = 13
    0x00,
    0x01, // transport_stream_id = 1
    0xc1, // version = 0, current_next = 1
    0x00,
    0x00, // section_number = 0, last_section_number = 0
    0x00,
    0x01, // program_number = 1
    0xe0 | ((pmtPid >> 8) & 0x1f),
    pmtPid & 0xff, // PMT PID
    0x00,
    0x00,
    0x00,
    0x00, // CRC32 (unchecked by parser)
  ]);
}

/**
 * Build a PMT section with two elementary streams.
 * @param {number} videoStreamType
 * @param {number} audioStreamType
 * @returns {Buffer} section bytes (starting with pointer_field = 0x00)
 */
function buildPMTSection(videoStreamType, audioStreamType) {
  // fixed header after section_length: program_number(2) + version(1) +
  //   section/last(2) + PCR_PID(2) + program_info_length(2) = 9
  // per stream: stream_type(1) + PID(2) + es_info_length(2) = 5
  // CRC32: 4
  // section_length = 9 + 2*5 + 4 = 23 = 0x17
  return Buffer.from([
    0x00, // pointer_field
    0x02, // table_id = PMT
    0xb0,
    0x17, // section_syntax_indicator | reserved | section_length = 23
    0x00,
    0x01, // program_number = 1
    0xc1, // version = 0, current_next = 1
    0x00,
    0x00, // section/last
    0xe1,
    0x01, // PCR_PID = 257
    0x00,
    0x00, // program_info_length = 0
    // video stream
    videoStreamType,
    0xe1,
    0x01, // PID = 257
    0x00,
    0x00, // es_info_length = 0
    // audio stream
    audioStreamType,
    0xe1,
    0x02, // PID = 258
    0x00,
    0x00, // es_info_length = 0
    0x00,
    0x00,
    0x00,
    0x00, // CRC32 (unchecked)
  ]);
}

/**
 * Build a minimal two-packet MPEG-TS buffer: PAT (PID 0) + PMT (given PID).
 * @param {number} pmtPid
 * @param {number} videoStreamType
 * @param {number} audioStreamType
 * @returns {Buffer}
 */
function buildMpegTsBuffer(pmtPid, videoStreamType, audioStreamType) {
  const pat = buildTsPacket(0, true, buildPATSection(pmtPid));
  const pmt = buildTsPacket(pmtPid, true, buildPMTSection(videoStreamType, audioStreamType));
  return Buffer.concat([pat, pmt]);
}

// ---------------------------------------------------------------------------
// parseMpegTsCodecs unit tests (no HTTP)
// ---------------------------------------------------------------------------

describe('parseMpegTsCodecs', () => {
  it('identifies MPEG-2 video + AC-3 audio as browser-incompatible', () => {
    const buf = buildMpegTsBuffer(256, 0x02, 0x81);
    const result = parseMpegTsCodecs(buf);
    expect(result).to.not.equal(null);
    expect(result.videoStreamType).to.equal(0x02);
    expect(result.audioStreamType).to.equal(0x81);
    expect(result.browserCompatible).to.equal(false);
  });

  it('identifies H.264 video + AAC audio as browser-compatible', () => {
    const buf = buildMpegTsBuffer(256, 0x1b, 0x0f);
    const result = parseMpegTsCodecs(buf);
    expect(result).to.not.equal(null);
    expect(result.videoStreamType).to.equal(0x1b);
    expect(result.audioStreamType).to.equal(0x0f);
    expect(result.browserCompatible).to.equal(true);
  });

  it('identifies MPEG-1 video as browser-incompatible', () => {
    const buf = buildMpegTsBuffer(256, 0x01, 0x0f);
    const result = parseMpegTsCodecs(buf);
    expect(result).to.not.equal(null);
    expect(result.browserCompatible).to.equal(false);
  });

  it('identifies E-AC-3 audio as browser-incompatible', () => {
    const buf = buildMpegTsBuffer(256, 0x1b, 0x87);
    const result = parseMpegTsCodecs(buf);
    expect(result).to.not.equal(null);
    expect(result.browserCompatible).to.equal(false);
  });

  it('returns null for a buffer that is not MPEG-TS', () => {
    const buf = Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n', 'utf8');
    expect(parseMpegTsCodecs(buf)).to.equal(null);
  });

  it('returns null for an empty buffer', () => {
    expect(parseMpegTsCodecs(Buffer.alloc(0))).to.equal(null);
  });

  it('handles a buffer that begins with one full packet of null padding before the sync boundary', () => {
    const realData = buildMpegTsBuffer(256, 0x02, 0x81);
    // Prepend 188 bytes of zeros (all-null TS padding).  findSyncOffset will confirm
    // the boundary at offset 188 (where buf[188] = 0x47 and buf[376] = 0x47).
    const garbage = Buffer.alloc(TS_PACKET_SIZE, 0x00);
    const buf = Buffer.concat([garbage, realData]);
    const result = parseMpegTsCodecs(buf);
    // With a full-packet-aligned garbage prefix the parser should still find PAT/PMT.
    expect(result).to.not.equal(null);
    expect(result.browserCompatible).to.equal(false);
    expect(result.videoStreamType).to.equal(0x02);
    expect(result.audioStreamType).to.equal(0x81);
  });
});

// ---------------------------------------------------------------------------
// /api/stream-probe integration tests
// ---------------------------------------------------------------------------

describe('Stream Probe Route Integration', () => {
  const channelsFile = getDataPath('channels.json');
  let originalChannels = null;
  let hadOriginalChannelsFile = false;
  let server = null;
  let baseUrl = '';
  // CONFIG_PATH isolation — keeps the real app.yaml untouched and ensures
  // requireAuth sees no admin_auth regardless of local developer config.
  let tmpConfigDir = null;
  let originalConfigPath = undefined;

  const testChannels = [
    {
      name: 'OTA Channel',
      tvg_id: 'ota.1',
      source: 'Antenna',
      original_url: 'http://hdhomerun-probe.local/auto/v6.1',
      hdhomerun: { deviceID: 'AABB1122' },
    },
    {
      name: 'IP Channel',
      tvg_id: 'ip.1',
      source: 'IPTV',
      original_url: 'http://iptv-probe.local/stream/ch1',
    },
  ];

  before(async () => {
    // Point CONFIG_PATH at a temp dir with an empty app.yaml so requireAuth
    // always passes through (no admin_auth present), regardless of the
    // developer's local config/app.yaml.
    tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stream-probe-test-'));
    await fs.writeFile(path.join(tmpConfigDir, 'app.yaml'), '{}\n', 'utf8');
    originalConfigPath = process.env.CONFIG_PATH;
    process.env.CONFIG_PATH = tmpConfigDir;
    invalidateAuthCache();

    await fs.mkdir(path.dirname(channelsFile), { recursive: true });
    try {
      originalChannels = await fs.readFile(channelsFile, 'utf8');
      hadOriginalChannelsFile = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    await fs.writeFile(channelsFile, JSON.stringify(testChannels), 'utf8');
    await initChannelsCache();

    const app = express();
    setupStreamProbeRoutes(app);
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
    nock.cleanAll();

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

    // Restore CONFIG_PATH and auth cache
    if (originalConfigPath === undefined) {
      delete process.env.CONFIG_PATH;
    } else {
      process.env.CONFIG_PATH = originalConfigPath;
    }
    invalidateAuthCache();

    if (tmpConfigDir) {
      await fs.rm(tmpConfigDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('returns 404 for an unknown channel', async () => {
    const res = await axios.get(`${baseUrl}/api/stream-probe/NoSource/NoChannel`, {
      validateStatus: () => true,
    });
    expect(res.status).to.equal(404);
  });

  it('returns { container: mpeg-ts, browserCompatible: false } for MPEG-2/AC-3 stream', async () => {
    const mpegTsBuf = buildMpegTsBuffer(256, 0x02, 0x81);

    nock('http://hdhomerun-probe.local')
      .get('/auto/v6.1')
      .reply(200, mpegTsBuf, { 'content-type': 'video/mp2t' });

    const res = await axios.get(`${baseUrl}/api/stream-probe/Antenna/OTA%20Channel`, {
      validateStatus: () => true,
    });

    expect(res.status).to.equal(200);
    expect(res.data.container).to.equal('mpeg-ts');
    expect(res.data.browserCompatible).to.equal(false);
    expect(res.data.videoStreamType).to.equal(0x02);
    expect(res.data.audioStreamType).to.equal(0x81);
  });

  it('returns { container: mpeg-ts, browserCompatible: true } for H.264/AAC stream', async () => {
    const mpegTsBuf = buildMpegTsBuffer(256, 0x1b, 0x0f);

    nock('http://iptv-probe.local')
      .get('/stream/ch1')
      .reply(200, mpegTsBuf, { 'content-type': 'video/mp2t' });

    const res = await axios.get(`${baseUrl}/api/stream-probe/IPTV/IP%20Channel`, {
      validateStatus: () => true,
    });

    expect(res.status).to.equal(200);
    expect(res.data.container).to.equal('mpeg-ts');
    expect(res.data.browserCompatible).to.equal(true);
    expect(res.data.videoStreamType).to.equal(0x1b);
    expect(res.data.audioStreamType).to.equal(0x0f);
  });

  it('returns { container: hls, browserCompatible: true } for an HLS response', async () => {
    nock('http://iptv-probe.local')
      .get('/stream/ch1')
      .reply(200, '#EXTM3U\n#EXT-X-VERSION:3\n', {
        'content-type': 'application/vnd.apple.mpegurl',
      });

    const res = await axios.get(`${baseUrl}/api/stream-probe/IPTV/IP%20Channel`, {
      validateStatus: () => true,
    });

    expect(res.status).to.equal(200);
    expect(res.data.container).to.equal('hls');
    expect(res.data.browserCompatible).to.equal(true);
  });

  it('appends ?streamMode=hls to upstream URL for HDHomeRun channels when requested', async () => {
    const mpegTsBuf = buildMpegTsBuffer(256, 0x1b, 0x0f);

    nock('http://hdhomerun-probe.local')
      .get('/auto/v6.1')
      .query({ streamMode: 'hls' })
      .reply(200, mpegTsBuf, { 'content-type': 'video/mp2t' });

    const res = await axios.get(
      `${baseUrl}/api/stream-probe/Antenna/OTA%20Channel?streamMode=hls`,
      { validateStatus: () => true },
    );

    expect(res.status).to.equal(200);
    expect(res.data.container).to.equal('mpeg-ts');
    expect(nock.isDone()).to.equal(true);
  });

  it('returns 502 when the upstream stream is unreachable', async () => {
    nock('http://iptv-probe.local').get('/stream/ch1').replyWithError('connection refused');

    const res = await axios.get(`${baseUrl}/api/stream-probe/IPTV/IP%20Channel`, {
      validateStatus: () => true,
    });

    expect(res.status).to.equal(502);
  });

  it('returns { container: mpeg-ts, browserCompatible: true } when PAT/PMT not found', async () => {
    // Send a valid sync-byte pattern but no recognisable PAT/PMT content.
    const emptyTs = Buffer.alloc(TS_PACKET_SIZE * 2, 0xff);
    emptyTs[0] = 0x47; // sync byte packet 1 — PID != 0 (all-ones = 0x1FFF = null packet)
    emptyTs[TS_PACKET_SIZE] = 0x47; // sync byte packet 2

    nock('http://iptv-probe.local')
      .get('/stream/ch1')
      .reply(200, emptyTs, { 'content-type': 'video/mp2t' });

    const res = await axios.get(`${baseUrl}/api/stream-probe/IPTV/IP%20Channel`, {
      validateStatus: () => true,
    });

    expect(res.status).to.equal(200);
    expect(res.data.container).to.equal('mpeg-ts');
    // Assume compatible when we cannot parse PAT/PMT (avoid false-positive transcoding).
    expect(res.data.browserCompatible).to.equal(true);
  });

  it('HDHomeRun channel probed without ?streamMode=hls correctly identifies MPEG-2/AC-3', async () => {
    // Regression test for the bug where the probe was sent with ?streamMode=hls.
    // HDHomeRun devices that support HLS mode wrap their MPEG-TS packets into an
    // HLS playlist but do NOT re-encode — the HLS segments still carry MPEG-2/AC-3.
    // Probing with ?streamMode=hls would receive an HLS content-type response and
    // return browserCompatible:true (incorrect).  The client now probes the raw
    // stream URL so the PAT/PMT parser can detect the underlying codecs.
    const mpegTsBuf = buildMpegTsBuffer(256, 0x02, 0x81);

    // Raw upstream URL — no ?streamMode=hls query param.
    nock('http://hdhomerun-probe.local').get('/auto/v6.1').reply(200, mpegTsBuf, {
      'content-type': 'video/mp2t',
    });

    const res = await axios.get(`${baseUrl}/api/stream-probe/Antenna/OTA%20Channel`, {
      validateStatus: () => true,
    });

    expect(res.status).to.equal(200);
    expect(res.data.container).to.equal('mpeg-ts');
    expect(res.data.browserCompatible).to.equal(false);
    expect(res.data.videoStreamType).to.equal(0x02);
    expect(res.data.audioStreamType).to.equal(0x81);
    // Confirm nock intercepted the correct (non-HLS) upstream path.
    expect(nock.isDone()).to.equal(true);
  });
});
