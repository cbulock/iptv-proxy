import axios from 'axios';
import { getChannels } from '../libs/channels-cache.js';
import { requireAuth } from './auth.js';

// Read at most 64 KB — enough to reliably find PAT and PMT in any MPEG-TS stream.
const PROBE_BYTES = 65536;

const TS_PACKET_SIZE = 188;
const TS_SYNC_BYTE = 0x47;
const PAT_PID = 0x0000;

// Video stream types the browser cannot decode natively via MSE.
const INCOMPATIBLE_VIDEO_STREAM_TYPES = new Set([
  0x01, // ISO/IEC 11172-2 — MPEG-1 video
  0x02, // ITU-T H.262 / ISO/IEC 13818-2 — MPEG-2 video (common on ATSC OTA)
  0x80, // DigiCipher II video (ATSC private)
]);

// Audio stream types the browser cannot decode natively via MSE.
const INCOMPATIBLE_AUDIO_STREAM_TYPES = new Set([
  0x03, // ISO/IEC 11172-3 — MPEG-1 audio
  0x04, // ISO/IEC 13818-3 — MPEG-2 audio backward-compatible
  0x81, // AC-3 / Dolby Digital (ATSC private — common on ATSC OTA)
  0x84, // SDDS audio
  0x87, // E-AC-3 / Dolby Digital Plus (ATSC private)
]);

// Known video stream types (used to distinguish video from data/subtitle PIDs).
const KNOWN_VIDEO_STREAM_TYPES = new Set([0x01, 0x02, 0x1b, 0x24, 0x42, 0x80]);

// Known audio stream types (used to distinguish audio from data/subtitle PIDs).
const KNOWN_AUDIO_STREAM_TYPES = new Set([
  0x03, 0x04, 0x0f, 0x11, 0x81, 0x82, 0x84, 0x86, 0x87,
]);

/**
 * Return the byte offset of the first confirmed MPEG-TS sync byte in buf.
 * Confirmation requires a second sync byte exactly TS_PACKET_SIZE bytes later.
 * Returns -1 when no valid sync boundary is found.
 * @param {Buffer} buf
 * @returns {number}
 */
function findSyncOffset(buf) {
  const limit = buf.length - TS_PACKET_SIZE;
  for (let i = 0; i <= limit; i++) {
    if (buf[i] === TS_SYNC_BYTE && buf[i + TS_PACKET_SIZE] === TS_SYNC_BYTE) {
      return i;
    }
  }
  return -1;
}

/**
 * Extract the payload slice from a TS packet at the given buffer offset.
 * Returns null when the packet is invalid or carries no payload.
 *
 * @param {Buffer} buf - buffer containing the packet
 * @param {number} offset - start of the 188-byte packet
 * @param {boolean} requirePusi - return null when PUSI flag is not set
 * @returns {{ payload: Buffer, pusi: boolean } | null}
 */
function getTsPacketPayload(buf, offset, requirePusi = false) {
  if (buf[offset] !== TS_SYNC_BYTE) return null;

  const pusi = (buf[offset + 1] >> 6) & 1;
  if (requirePusi && !pusi) return null;

  const adaptControl = (buf[offset + 3] >> 4) & 0x03;
  const hasPayload = adaptControl === 0x01 || adaptControl === 0x03;
  if (!hasPayload) return null;

  let payloadStart = offset + 4;
  if (adaptControl === 0x03) {
    payloadStart = offset + 5 + buf[offset + 4]; // skip adaptation field
  }
  if (payloadStart >= offset + TS_PACKET_SIZE) return null;

  return {
    payload: buf.slice(payloadStart, offset + TS_PACKET_SIZE),
    pusi: Boolean(pusi),
  };
}

/**
 * Parse a PAT section and return all programs (skipping the NIT entry at program 0).
 * @param {Buffer} section - bytes starting at table_id
 * @returns {Array<{ programNumber: number, pmtPid: number }>}
 */
function parsePATSection(section) {
  if (section.length < 8 || section[0] !== 0x00) return [];

  const sectionLength = ((section[1] & 0x0f) << 8) | section[2];
  const programs = [];

  // PAT fixed header occupies bytes 0–7 (table_id + section_length field + 5 fixed bytes).
  // Each program entry is 4 bytes.  The last 4 bytes of sectionLength are the CRC32.
  for (let i = 8; i + 3 < sectionLength - 1 && i + 3 < section.length; i += 4) {
    const programNumber = (section[i] << 8) | section[i + 1];
    const pmtPid = ((section[i + 2] & 0x1f) << 8) | section[i + 3];
    if (programNumber !== 0) programs.push({ programNumber, pmtPid });
  }

  return programs;
}

/**
 * Parse a PMT section and return all elementary streams.
 * @param {Buffer} section - bytes starting at table_id
 * @returns {Array<{ streamType: number, pid: number }>}
 */
function parsePMTSection(section) {
  if (section.length < 12 || section[0] !== 0x02) return [];

  const sectionLength = ((section[1] & 0x0f) << 8) | section[2];
  // PMT fixed header is 12 bytes (table_id=1, section_length=2, program_number=2,
  // version=1, section/last=2, PCR_PID=2, program_info_length=2).
  const programInfoLength = ((section[10] & 0x0f) << 8) | section[11];
  const streams = [];

  // Stream entries start after the program descriptors.
  // Each entry is at least 5 bytes; ES_info_length determines extra descriptor bytes.
  // Loop guard keeps j + 4 within the content area (before CRC32).
  let j = 12 + programInfoLength;
  while (j + 4 < sectionLength - 1 && j + 4 < section.length) {
    const streamType = section[j];
    const pid = ((section[j + 1] & 0x1f) << 8) | section[j + 2];
    const esInfoLength = ((section[j + 3] & 0x0f) << 8) | section[j + 4];
    streams.push({ streamType, pid });
    j += 5 + esInfoLength;
  }

  return streams;
}

/**
 * Scan a raw MPEG-TS buffer and return the first video and audio stream types
 * discovered via PAT → PMT traversal.
 *
 * Returns null when the buffer does not contain a recognisable MPEG-TS structure
 * (missing sync, no PAT, or no PMT within the scanned range).
 *
 * @param {Buffer} buf - raw MPEG-TS bytes
 * @returns {{ videoStreamType: number|null, audioStreamType: number|null, browserCompatible: boolean } | null}
 */
function getPsiSectionTotalLength(section) {
  if (!section || section.length < 3) return null;

  const sectionLength = ((section[1] & 0x0f) << 8) | section[2];
  if (sectionLength <= 0) return null;

  return 3 + sectionLength;
}

function appendPsiSectionBytes(state, bytes, completeSections) {
  if (!bytes || bytes.length === 0) return;

  state.buffer = state.buffer ? Buffer.concat([state.buffer, bytes]) : Buffer.from(bytes);

  while (state.buffer.length >= 3) {
    const totalLength = getPsiSectionTotalLength(state.buffer);
    if (totalLength === null) {
      state.buffer = null;
      return;
    }

    if (state.buffer.length < totalLength) return;

    completeSections.push(state.buffer.slice(0, totalLength));
    state.buffer = state.buffer.length === totalLength ? null : state.buffer.slice(totalLength);
  }
}

function extractPsiSectionsFromPacketPayload(state, payload, payloadUnitStartIndicator) {
  const completeSections = [];
  if (!payload || payload.length === 0) return completeSections;

  if (!payloadUnitStartIndicator) {
    appendPsiSectionBytes(state, payload, completeSections);
    return completeSections;
  }

  const pointer = payload[0];
  let cursor = 1;
  const nextSectionStart = Math.min(payload.length, cursor + pointer);

  if (state.buffer && nextSectionStart > cursor) {
    appendPsiSectionBytes(state, payload.slice(cursor, nextSectionStart), completeSections);
  }

  cursor = nextSectionStart;
  state.buffer = null;

  while (cursor < payload.length) {
    const remaining = payload.slice(cursor);
    const totalLength = getPsiSectionTotalLength(remaining);

    if (totalLength === null) break;

    if (remaining.length >= totalLength) {
      completeSections.push(remaining.slice(0, totalLength));
      cursor += totalLength;
      continue;
    }

    state.buffer = Buffer.from(remaining);
    break;
  }

  return completeSections;
}

export function parseMpegTsCodecs(buf) {
  const syncOffset = findSyncOffset(buf);
  if (syncOffset === -1) return null;

  const packets = Math.floor((buf.length - syncOffset) / TS_PACKET_SIZE);

  // Pass 1: locate PAT sections (PID 0) and collect PMT PIDs.
  const pmtPids = new Set();
  const patState = { buffer: null };

  for (let i = 0; i < packets; i++) {
    const offset = syncOffset + i * TS_PACKET_SIZE;
    const pid = ((buf[offset + 1] & 0x1f) << 8) | buf[offset + 2];
    if (pid !== PAT_PID) continue;

    const hasPayload = (buf[offset + 3] & 0x10) !== 0;
    if (!hasPayload) continue;

    const payloadUnitStartIndicator = (buf[offset + 1] & 0x40) !== 0;
    const result = getTsPacketPayload(buf, offset, false /* requirePusi */);
    if (!result) continue;

    const sections = extractPsiSectionsFromPacketPayload(
      patState,
      result.payload,
      payloadUnitStartIndicator
    );

    for (const section of sections) {
      const programs = parsePATSection(section);
      for (const { pmtPid } of programs) pmtPids.add(pmtPid);
    }

    if (pmtPids.size > 0) break; // PAT found; no need to scan further
  }

  if (pmtPids.size === 0) return null;

  // Pass 2: locate PMT section(s) and extract elementary stream types.
  let videoStreamType = null;
  let audioStreamType = null;
  const pmtStates = new Map();

  for (let i = 0; i < packets; i++) {
    const offset = syncOffset + i * TS_PACKET_SIZE;
    const pid = ((buf[offset + 1] & 0x1f) << 8) | buf[offset + 2];
    if (!pmtPids.has(pid)) continue;

    const hasPayload = (buf[offset + 3] & 0x10) !== 0;
    if (!hasPayload) continue;

    const payloadUnitStartIndicator = (buf[offset + 1] & 0x40) !== 0;
    const result = getTsPacketPayload(buf, offset, false /* requirePusi */);
    if (!result) continue;

    let state = pmtStates.get(pid);
    if (!state) {
      state = { buffer: null };
      pmtStates.set(pid, state);
    }

    const sections = extractPsiSectionsFromPacketPayload(
      state,
      result.payload,
      payloadUnitStartIndicator
    );

    for (const section of sections) {
      const streams = parsePMTSection(section);
      for (const { streamType } of streams) {
        if (videoStreamType === null && KNOWN_VIDEO_STREAM_TYPES.has(streamType)) {
          videoStreamType = streamType;
        }
        if (audioStreamType === null && KNOWN_AUDIO_STREAM_TYPES.has(streamType)) {
          audioStreamType = streamType;
        }
      }
    }

    if (videoStreamType !== null && audioStreamType !== null) break;
  }

  if (videoStreamType === null && audioStreamType === null) return null;

  const browserCompatible =
    (videoStreamType === null || !INCOMPATIBLE_VIDEO_STREAM_TYPES.has(videoStreamType)) &&
    (audioStreamType === null || !INCOMPATIBLE_AUDIO_STREAM_TYPES.has(audioStreamType));

  return { videoStreamType, audioStreamType, browserCompatible };
}

/**
 * Read up to maxBytes from an axios stream response, then stop.
 * @param {import('stream').Readable} stream
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
async function readStreamBytes(stream, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = maxBytes - total;
    if (buf.length >= remaining) {
      chunks.push(buf.slice(0, remaining));
      break;
    }
    chunks.push(buf);
    total += buf.length;
  }
  return Buffer.concat(chunks);
}

/**
 * Set up the stream codec-probe route.
 *
 * GET /api/stream-probe/:source/:name
 *
 * Fetches the first PROBE_BYTES of the channel's upstream stream and parses the
 * MPEG-TS PAT/PMT tables to determine whether the video and audio codecs can be
 * decoded natively by browser MSE.  The result is used by the admin UI to
 * automatically switch to server-side transcoding when incompatible codecs are
 * detected (e.g. MPEG-2 video or AC-3 audio from ATSC OTA broadcasts).
 *
 * Response shape:
 *   { container: 'hls'|'mpeg-ts'|'unknown',
 *     browserCompatible: boolean,
 *     videoStreamType: number|null,
 *     audioStreamType: number|null }
 *
 * @param {import('express').Application} app
 */
export function setupStreamProbeRoutes(app) {
  app.get('/api/stream-probe/:source/:name', requireAuth, async (req, res) => {
    const { source, name } = req.params;
    const channels = getChannels();
    const channel = channels.find(c => c.source === source && c.name === name);

    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const upstreamUrl = channel.original_url;
    if (!upstreamUrl) return res.status(404).json({ error: 'No upstream URL for channel' });

    const isHdhomerun = Boolean(channel.hdhomerun);
    const requestedStreamMode = String(req.query.streamMode || '').toLowerCase();

    // Mirror the stream proxy's ?streamMode=hls behaviour: when probing an
    // HDHomeRun channel that the browser will request with HLS mode, we must
    // probe the same URL the device will actually serve — otherwise modern
    // firmware that supports HLS would appear incompatible.
    let probeUrl = upstreamUrl;
    if (isHdhomerun && requestedStreamMode === 'hls') {
      try {
        const url = new URL(upstreamUrl);
        url.searchParams.set('streamMode', 'hls');
        probeUrl = url.toString();
      } catch {
        // Malformed upstream URL — probe without modification.
      }
    }

    console.info(
      '[stream-probe] %s/%s hdhomerun=%s streamMode=%s probeUrl=%s',
      source,
      name,
      isHdhomerun,
      requestedStreamMode || '(none)',
      probeUrl
    );

    let response;
    try {
      response = await axios.get(probeUrl, {
        responseType: 'stream',
        timeout: 10000,
        // Ask for only the bytes we need; many servers honour this and save bandwidth.
        headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
      });
    } catch (err) {
      console.warn('[stream-probe] upstream fetch failed %s/%s: %s', source, name, err.message);
      return res.status(502).json({ error: 'Failed to reach upstream stream' });
    }

    // An HLS content-type means the upstream is serving a playlist — no need to
    // read the body; the browser can play HLS natively (via HLS.js in the UI).
    const contentType = (response.headers['content-type'] || '').toLowerCase();
    const upstreamStatus = response.status;

    console.info(
      '[stream-probe] %s/%s upstream status=%d content-type="%s"',
      source,
      name,
      upstreamStatus,
      contentType || '(empty)'
    );

    if (
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegurl') ||
      contentType.includes('audio/mpegurl')
    ) {
      response.data.destroy();
      console.info('[stream-probe] %s/%s -> container=hls browserCompatible=true', source, name);
      return res.json({
        container: 'hls',
        browserCompatible: true,
        videoStreamType: null,
        audioStreamType: null,
      });
    }

    const isMpegTsContentType =
      contentType.startsWith('video/mp2t') || contentType.startsWith('video/mpeg');

    let buf;
    try {
      buf = await readStreamBytes(response.data, PROBE_BYTES);
    } catch (err) {
      console.warn('[stream-probe] stream read failed %s/%s: %s', source, name, err.message);
      return res.status(502).json({ error: 'Failed to read stream data' });
    } finally {
      try {
        response.data.destroy();
      } catch {
        // ignore
      }
    }

    const syncOffset = findSyncOffset(buf);
    console.info(
      '[stream-probe] %s/%s read %d bytes isMpegTsContentType=%s syncOffset=%d',
      source,
      name,
      buf.length,
      isMpegTsContentType,
      syncOffset
    );

    // Attempt MPEG-TS PAT/PMT parsing when the content-type signals MPEG-TS or
    // when the raw bytes look like a TS stream (sync byte at position 0 or 188).
    if (isMpegTsContentType || syncOffset !== -1) {
      const codecInfo = parseMpegTsCodecs(buf);
      if (codecInfo) {
        console.info(
          '[stream-probe] %s/%s -> container=mpeg-ts browserCompatible=%s video=0x%s audio=0x%s',
          source,
          name,
          codecInfo.browserCompatible,
          (codecInfo.videoStreamType ?? 0).toString(16).padStart(2, '0'),
          (codecInfo.audioStreamType ?? 0).toString(16).padStart(2, '0')
        );
        return res.json({ container: 'mpeg-ts', ...codecInfo });
      }
      // PAT/PMT not found within the probed range.  Assume compatible to avoid
      // incorrectly routing a live stream to transcoding.
      console.info(
        '[stream-probe] %s/%s -> container=mpeg-ts browserCompatible=true (no PAT/PMT found)',
        source,
        name
      );
      return res.json({
        container: 'mpeg-ts',
        browserCompatible: true,
        videoStreamType: null,
        audioStreamType: null,
      });
    }

    // Unknown format — assume compatible.
    console.info(
      '[stream-probe] %s/%s -> container=unknown browserCompatible=true (unrecognised format)',
      source,
      name
    );
    return res.json({
      container: 'unknown',
      browserCompatible: true,
      videoStreamType: null,
      audioStreamType: null,
    });
  });
}
