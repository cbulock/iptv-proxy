import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import http from 'http';
import https from 'https';
import axios from 'axios';
import RateLimit from 'express-rate-limit';
import { getOutputProfile, getOutputProfileChannels } from '../libs/output-profile-service.js';
import { listSources } from '../libs/source-service.js';
import { extractTextField, getPublishedGuideSnapshot, parseXMLTVDate } from './epg.js';

const PAGE_SIZE = 1000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 8000;
const cursorKey = crypto.randomBytes(32);
const limiter = RateLimit({
  windowMs: 60000,
  max: 120,
  skip: req => ['::1', '127.0.0.1'].includes(req.ip),
});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

export function plainText(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return extractTextField(value).replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, key) => {
      if (key[0] !== '#') return entities[key.toLowerCase()] ?? match;
      const number =
        key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number)
        : match;
    }
  );
}

function timestamp(value) {
  const parts = String(value || '').match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/
  );
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, , zoneHour = '0', zoneMinute = '0'] = parts;
  const local = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  if (
    local.getUTCMonth() !== +month - 1 ||
    local.getUTCDate() !== +day ||
    +hour > 23 ||
    +minute > 59 ||
    +second > 59 ||
    +zoneHour > 23 ||
    +zoneMinute > 59
  )
    return null;
  return parseXMLTVDate(value)?.getTime() ?? null;
}

function formatHint(channel) {
  try {
    const url = new URL(channel.original_url);
    if (
      /\.m3u8$/i.test(url.pathname) ||
      url.searchParams.get('streamMode')?.toLowerCase() === 'hls'
    )
      return 'hls';
  } catch {
    /* incomplete source metadata */
  }
  return channel.hdhomerun || channel.type === 'hdhomerun' ? 'ts' : 'unknown';
}

export function channelProjection(channel, icons) {
  const target = channel.sourceChannelId
    ? `channel/${encodeURIComponent(channel.sourceChannelId)}`
    : `${encodeURIComponent(channel.source || '')}/${encodeURIComponent(channel.streamName || channel.name || '')}`;
  return {
    id: channel.canonicalId,
    tvgId: channel.tvg_id || '',
    name: plainText(channel.name),
    number: String(channel.guideNumber || ''),
    source: plainText(channel.source || ''),
    group: plainText(channel.group || ''),
    logo:
      channel.logo || icons.get(channel.tvg_id)
        ? `/artwork/${encodeURIComponent(channel.canonicalId)}`
        : null,
    streamUrl: `/stream/${target}`,
    transcodeUrl: `/transcode/${target}`,
    formatHint: formatHint(channel),
  };
}

function encodeCursor(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', cursorKey).update(body).digest('base64url')}`;
}
function decodeCursor(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('cursor');
  const [body, signature, extra] = value.split('.');
  const expected = crypto
    .createHmac('sha256', cursorKey)
    .update(body || '')
    .digest('base64url');
  if (
    extra ||
    !signature ||
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new Error('cursor');
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (
    !Number.isSafeInteger(parsed.offset) ||
    parsed.offset < 0 ||
    parsed.offset % PAGE_SIZE ||
    !Number.isSafeInteger(parsed.from) ||
    !Number.isInteger(parsed.hours) ||
    parsed.hours < 1 ||
    parsed.hours > 48 ||
    typeof parsed.revision !== 'string' ||
    Date.now() - parsed.from > 8 * 3600000 ||
    parsed.from > Date.now() + 60000
  )
    throw new Error('cursor');
  return parsed;
}

export function publishedGuidePage(channels, snapshot, query = {}, now = Date.now()) {
  let cursor;
  let hours = query.hours === undefined ? 48 : Number(query.hours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 48 || Array.isArray(query.hours))
    return { status: 400, error: 'Invalid guide window', code: 'INVALID_WINDOW' };
  try {
    if (query.cursor !== undefined) {
      cursor = decodeCursor(query.cursor);
      if (query.hours !== undefined && hours !== cursor.hours) throw new Error('window');
      hours = cursor.hours;
    }
  } catch {
    return { status: 400, error: 'Invalid guide cursor', code: 'INVALID_CURSOR' };
  }
  const revision = hash(JSON.stringify([snapshot.revision, channels]));
  if (cursor && revision !== cursor.revision)
    return { status: 409, error: 'Guide changed; refresh the guide', code: 'GUIDE_CHANGED' };
  const from = cursor?.from ?? now;
  const until = from + hours * 3600000;
  const programmes = [];
  for (const channel of channels) {
    const records = (snapshot.programmes.get(channel.tvg_id) || [])
      .map(p => ({ p, start: timestamp(p['@_start']) }))
      .filter(p => p.start !== null)
      .sort((a, b) => a.start - b.start);
    let nextStart = null;
    for (let i = records.length - 1; i >= 0; i--) {
      if (i < records.length - 1 && records[i + 1].start > records[i].start)
        nextStart = records[i + 1].start;
      records[i].nextStart = nextStart;
    }
    for (let i = 0; i < records.length; i++) {
      const { p, start } = records[i];
      let stop = timestamp(p['@_stop']);
      if (stop !== null && stop <= start) stop = null;
      if (stop === null) {
        const next = records[i].nextStart;
        if (next && next - start <= 12 * 3600000) stop = next;
      }
      if (start >= until || (stop === null ? start < from - 60000 : stop <= from)) continue;
      const title = plainText(p.title);
      const subtitle = plainText(p['sub-title']);
      programmes.push({
        id: hash(JSON.stringify([channel.canonicalId, start, title])),
        channelId: channel.canonicalId,
        title,
        description: plainText(p.desc),
        start: new Date(start).toISOString(),
        stop: stop === null ? null : new Date(stop).toISOString(),
        ...(subtitle ? { subtitle } : {}),
      });
    }
  }
  programmes.sort(
    (a, b) =>
      a.start.localeCompare(b.start) ||
      a.channelId.localeCompare(b.channelId) ||
      a.id.localeCompare(b.id)
  );
  const offset = cursor?.offset ?? 0;
  if (cursor && offset >= programmes.length)
    return { status: 400, error: 'Invalid guide cursor', code: 'INVALID_CURSOR' };
  return {
    programmes: programmes.slice(offset, offset + PAGE_SIZE),
    fetchedAt: new Date(from).toISOString(),
    revision,
    nextCursor:
      offset + PAGE_SIZE < programmes.length
        ? encodeCursor({ revision, from, hours, offset: offset + PAGE_SIZE })
        : null,
  };
}

function addressClass(address) {
  let ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.startsWith('::ffff:')) {
    const suffix = ip.slice(7);
    if (net.isIP(suffix) === 4) ip = suffix;
    else {
      const parts = suffix.split(':');
      if (parts.length === 2)
        ip = `${parseInt(parts[0], 16) >> 8}.${parseInt(parts[0], 16) & 255}.${parseInt(parts[1], 16) >> 8}.${parseInt(parts[1], 16) & 255}`;
    }
  }
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 127 || (a === 169 && b === 254) || a >= 224) return 'blocked';
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
      return 'private';
    return 'public';
  }
  if (net.isIP(ip) === 6) {
    if (ip === '::' || ip === '::1' || /^fe[89ab]/.test(ip) || ip.startsWith('ff'))
      return 'blocked';
    return /^f[cd]/.test(ip) ? 'private' : 'public';
  }
  return 'hostname';
}

export function artworkDestination(value, sources) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const configured = new Set();
  for (const source of sources)
    for (const value of [source.url, source.epg]) {
      try {
        const parsed = new URL(value);
        if (['http:', 'https:'].includes(parsed.protocol))
          configured.add(parsed.hostname.toLowerCase());
      } catch {
        /* local file or absent feed */
      }
    }
  const hostname = url.hostname.toLowerCase();
  const approved = new Set(
    (process.env.ARTWORK_ALLOWED_HOSTS || '')
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!configured.has(hostname) && !approved.has(hostname)) return null;
  const kind = addressClass(hostname);
  if (kind === 'blocked' || (kind === 'private' && !configured.has(hostname))) return null;
  const lookup = (host, options, callback) => {
    dns.lookup(host, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      if (
        !addresses.length ||
        addresses.some(record => {
          const type = addressClass(record.address);
          return type === 'blocked' || (type === 'private' && !configured.has(hostname));
        })
      )
        return callback(new Error('Invalid artwork destination'));
      if (options?.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
  return { url, lookup };
}

async function fetchArtwork(url, options) {
  return axios.get(url, {
    responseType: 'stream',
    timeout: IMAGE_TIMEOUT_MS,
    signal: options.signal,
    maxRedirects: 0,
    validateStatus: () => true,
    proxy: false,
    httpAgent: new http.Agent({ lookup: options.lookup }),
    httpsAgent: new https.Agent({ lookup: options.lookup }),
  });
}

function loadPublishedChannels() {
  if (!getOutputProfile()?.enabled) return [];
  const sources = new Map(listSources().map(source => [source.name, source]));
  return getOutputProfileChannels().map(channel => ({
    ...channel,
    type: sources.get(channel.source)?.type,
  }));
}

export function getPublishedChannelsData() {
  const snapshot = getPublishedGuideSnapshot();
  return {
    channels: loadPublishedChannels().map(channel => channelProjection(channel, snapshot.icons)),
    fetchedAt: new Date().toISOString(),
  };
}

export function getPublishedGuideData(query = {}) {
  return publishedGuidePage(loadPublishedChannels(), getPublishedGuideSnapshot(), query);
}

function isRaster(bytes, mime) {
  if (mime === 'image/png')
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/gif') return /^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii'));
  if (mime === 'image/webp')
    return (
      bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    );
  return (
    bytes.subarray(4, 8).toString() === 'ftyp' &&
    /avif|avis/.test(bytes.subarray(8, 32).toString('ascii'))
  );
}

export function setupLiveTvRoutes(app, dependencies = {}) {
  const getChannels = dependencies.getChannels || loadPublishedChannels;
  const getSnapshot = dependencies.getSnapshot || getPublishedGuideSnapshot;
  const getSources = dependencies.getSources || listSources;
  const fetchImage = dependencies.fetchImage || fetchArtwork;
  app.get('/channels.json', limiter, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      channels: getChannels().map(c => channelProjection(c, getSnapshot().icons)),
      fetchedAt: new Date().toISOString(),
    });
  });
  app.get('/guide.json', limiter, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { status = 200, ...body } = publishedGuidePage(getChannels(), getSnapshot(), req.query);
    res.status(status).json(body);
  });
  app.get('/artwork/:channelId', limiter, async (req, res) => {
    const channel = getChannels().find(c => c.canonicalId === req.params.channelId);
    const destination =
      channel &&
      artworkDestination(channel.logo || getSnapshot().icons.get(channel.tvg_id), getSources());
    if (!destination) return res.status(404).json({ error: 'Artwork not found' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetchImage(destination.url.href, {
        signal: controller.signal,
        lookup: destination.lookup,
      });
      const mime = String(upstream.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (
        upstream.status !== 200 ||
        !/^image\/(png|jpeg|webp|gif|avif)$/.test(mime) ||
        Number(upstream.headers['content-length']) > MAX_IMAGE_BYTES
      )
        throw new Error('Invalid artwork');
      const chunks = [];
      let size = 0;
      for await (const chunk of upstream.data) {
        if (controller.signal.aborted) throw new Error('Timeout');
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) throw new Error('Artwork too large');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (!isRaster(bytes, mime)) throw new Error('Invalid raster');
      res.setHeader('Content-Type', mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(bytes);
    } catch {
      res.status(502).json({ error: 'Artwork unavailable', code: 'ARTWORK_UNAVAILABLE' });
    } finally {
      clearTimeout(timer);
      upstream?.data?.destroy();
      controller.abort();
    }
  });
}
