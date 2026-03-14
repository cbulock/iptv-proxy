import axios from 'axios';
import RateLimit from 'express-rate-limit';
import { getProxiedImageUrl } from '../libs/proxy-image.js';
import getBaseUrl from '../libs/getBaseUrl.js';
import { getChannels } from '../libs/channels-cache.js';
import { asyncHandler, AppError } from './error-handler.js';
import cacheManager from '../libs/cache-manager.js';
import { loadConfig } from '../libs/config-loader.js';

// Rate limiter for public playlist endpoints
const lineupLimiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per minute
  skip: (req) => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: (req) => req.ip || 'unknown',
});

// M3U and JSON lineup caches
let m3uCache = null;
let jsonCache = null;

// Invalidate caches when channels are updated
let lastChannelsUpdate = Date.now();

function invalidateCaches() {
  if (m3uCache) m3uCache.clear();
  if (jsonCache) jsonCache.clear();
  lastChannelsUpdate = Date.now();
}

function isLikelyHlsPlaylist(contentType = '', upstreamUrl = '') {
  const normalizedContentType = String(contentType).toLowerCase();
  if (
    normalizedContentType.includes('application/vnd.apple.mpegurl') ||
    normalizedContentType.includes('application/x-mpegurl') ||
    normalizedContentType.includes('audio/mpegurl') ||
    normalizedContentType.includes('audio/x-mpegurl')
  ) {
    return true;
  }

  try {
    const url = new URL(upstreamUrl);
    if (url.pathname.toLowerCase().endsWith('.m3u8')) return true;
    if (String(url.searchParams.get('streamMode') || '').toLowerCase() === 'hls') return true;
  } catch (_err) {
    return false;
  }

  return false;
}

async function readStreamToUtf8(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function rewriteUriToProxy(uri, playlistUrl, req, source, name) {
  const trimmed = String(uri || '').trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('#')) return trimmed;
  if (/^(data|blob):/i.test(trimmed)) return trimmed;

  let resolvedUrl;
  try {
    resolvedUrl = new URL(trimmed, playlistUrl).toString();
  } catch (_err) {
    return trimmed;
  }

  const baseUrl = getBaseUrl(req);
  const sourcePart = encodeURIComponent(source || 'unknown');
  const namePart = encodeURIComponent(name || 'unknown');
  return `${baseUrl}/stream/${sourcePart}/${namePart}?upstream=${encodeURIComponent(resolvedUrl)}`;
}

function rewriteHlsPlaylist(body, playlistUrl, req, source, name) {
  const lines = String(body || '').split('\n');
  const rewritten = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
        const rewrittenUri = rewriteUriToProxy(uri, playlistUrl, req, source, name);
        return `URI="${rewrittenUri}"`;
      });
    }

    return rewriteUriToProxy(trimmed, playlistUrl, req, source, name);
  });

  return rewritten.join('\n');
}

function resolveGuideNumberForLineup(channel) {
  // HDHomeRun clients often match XMLTV by GuideNumber; use tvg_id when present
  // so subchannels like 6.1/23.1 align with XMLTV channel ids.
  if (channel?.hdhomerun && channel?.tvg_id) {
    return channel.tvg_id;
  }
  return channel?.guideNumber || channel?.tvg_id || channel?.name;
}

function isChannelMapped(channel, map, mapKeys) {
  const name = channel?.name || '';
  const tvgId = channel?.tvg_id || '';

  if (mapKeys.has(name)) return true;
  if (tvgId && mapKeys.has(tvgId)) return true;

  if (tvgId) {
    for (const value of Object.values(map || {})) {
      if (value && value.tvg_id === tvgId) return true;
    }
  }

  return false;
}

function parseBooleanQueryParam(value) {
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function setupLineupRoutes(app, config, usageHelpers = {}) {
  // Initialize lineup caches with TTL from config (default: 1 hour)
  const appConfig = loadConfig('app');
  const m3uTTL = (appConfig.cache?.m3u_ttl ?? 3600) * 1000; // Convert seconds to milliseconds
  m3uCache = cacheManager.createCache('m3u', m3uTTL);
  jsonCache = cacheManager.createCache('lineup-json', m3uTTL);
  console.log(`Lineup caches initialized with TTL: ${m3uTTL / 1000}s`);

  const {
    registerUsage = async () => undefined,
    touchUsage = () => undefined,
    unregisterUsage = () => undefined
  } = usageHelpers;
  const loadChannels = () => getChannels();

  app.get('/lineup.json', lineupLimiter, asyncHandler(async (req, res) => {
    const includeUnmapped = parseBooleanQueryParam(req.query.include_unmapped ?? req.query.includeUnmapped);
    const cacheKey = `${req.protocol}://${req.get('host')}|include_unmapped:${includeUnmapped ? '1' : '0'}`;
    
    // Check cache
    const cached = jsonCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    let channels = loadChannels();
    
    // Validate that we have channels
    if (!Array.isArray(channels)) {
      throw new AppError('Invalid channels data structure', 500);
    }

    if (!includeUnmapped) {
      const channelMap = loadConfig('channelMap') || {};
      const mapKeys = new Set(Object.keys(channelMap));
      channels = channels.filter(channel => isChannelMapped(channel, channelMap, mapKeys));
    }

    const baseUrl = getBaseUrl(req);
    const lineup = channels
      .filter(channel => channel && channel.name) // Filter out invalid channels
      .map(channel => ({
        GuideNumber: resolveGuideNumberForLineup(channel),
        GuideName: channel.name,
        URL: `${baseUrl}/stream/${encodeURIComponent(channel.source || 'unknown')}/${encodeURIComponent(channel.name)}`
      }));

    // Cache the result
    jsonCache.set(cacheKey, lineup);
    
    res.json(lineup);
  }));

  app.get('/lineup.m3u', lineupLimiter, asyncHandler(async (req, res) => {
    // Extract query parameters for filtering
    const filterSource = req.query.source ? String(req.query.source) : null;
    const filterGroup = req.query.group ? String(req.query.group) : null;
    const includeUnmapped = parseBooleanQueryParam(req.query.include_unmapped ?? req.query.includeUnmapped);
    
    // Create cache key including filters
    const cacheKey = `${req.protocol}://${req.get('host')}|source:${filterSource || ''}|group:${filterGroup || ''}|include_unmapped:${includeUnmapped ? '1' : '0'}`;
    
    // Check cache
    const cached = m3uCache.get(cacheKey);
    if (cached) {
      res.set('Content-Type', 'application/x-mpegURL');
      return res.send(cached);
    }
    
    let channels = loadChannels();
    
    // Validate that we have channels
    if (!Array.isArray(channels)) {
      throw new AppError('Invalid channels data structure', 500);
    }
    
    // Apply filters (note: source and group both filter by channel.source since group-title=source)
    if (filterSource) {
      channels = channels.filter(ch => ch && ch.source === filterSource);
    } else if (filterGroup) {
      // group-title in M3U is set to channel.source, so this filters the same way
      channels = channels.filter(ch => ch && ch.source === filterGroup);
    }
    
    // Filter out invalid channels
    channels = channels.filter(ch => ch && ch.name && ch.source);

    if (!includeUnmapped) {
      const channelMap = loadConfig('channelMap') || {};
      const mapKeys = new Set(Object.keys(channelMap));
      channels = channels.filter(channel => isChannelMapped(channel, channelMap, mapKeys));
    }
    
    const tvgIdMap = new Map(); // For deduplication
    const baseUrl = getBaseUrl(req);

    const epgUrl = `${baseUrl}/xmltv.xml`;
    let output = `#EXTM3U url-tvg="${epgUrl}" x-tvg-url="${epgUrl}"\n`;

    for (const channel of channels) {
      try {
        let tvgId = channel.tvg_id || '';
        const originalTvgId = tvgId;

        // Deduplicate tvg-id
        if (tvgIdMap.has(tvgId)) {
          let i = 1;
          while (tvgIdMap.has(`${originalTvgId}_${i}`)) i++;
          tvgId = `${originalTvgId}_${i}`;
        }
        if (tvgId) tvgIdMap.set(tvgId, true);

        const tvgName = channel.name || '';
        const tvgLogo = channel.logo
          ? getProxiedImageUrl(channel.logo, channel.source || 'unknown', req)
          : '';
        const tvgChno = channel.guideNumber || '';
        const groupTitle = channel.source || '';
        const streamUrl = `${baseUrl}/stream/${encodeURIComponent(channel.source)}/${encodeURIComponent(channel.name)}`;

        output += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${tvgName}" tvg-logo="${tvgLogo}" group-title="${groupTitle}"`;
        if (tvgChno) {
          output += ` tvg-chno="${tvgChno}"`;
        }
        output += `,${tvgName}\n`;
        output += `${streamUrl}\n`;
      } catch (channelErr) {
        // Log but continue processing other channels
        console.warn(`[lineup.m3u] Skipping invalid channel: ${channelErr.message}`);
      }
    }
    
    // Cache the result
    m3uCache.set(cacheKey, output);

    res.set('Content-Type', 'application/x-mpegURL');
    res.send(output);
  }));

  app.all('/stream/:source/:name', async (req, res) => {
    const { source, name } = req.params;
    const upstreamOverride = req.query.upstream ? String(req.query.upstream) : null;
    const channels = loadChannels();

    const channel = channels.find(
      c => c.source === source && c.name === name
    );

    if (!channel) return res.status(404).send('Channel not found');

    let upstreamUrl = upstreamOverride || channel.original_url;

    // HDHomeRun supports HLS via ?streamMode=hls; request it so browsers can play the stream
    // via HLS.js instead of receiving raw MPEG-TS which browsers cannot decode natively.
    if (!upstreamOverride && channel.hdhomerun) {
      try {
        const u = new URL(upstreamUrl);
        u.searchParams.set('streamMode', 'hls');
        upstreamUrl = u.toString();
      } catch (err) {
        // If the URL is unparseable, fall through and let the upstream decide.
        console.warn(
          '[stream] failed to apply streamMode=hls for %s/%s (invalid URL: %s): %s',
          source,
          name,
          upstreamUrl,
          err && err.message ? err.message : String(err)
        );
      }
    }

    const startTime = Date.now();
    console.info('[stream] %s/%s -> %s', source, name, upstreamUrl);

    if (req.method === 'HEAD') {
      try {
        const response = await axios.head(upstreamUrl, { timeout: 5000 });
        res.set(response.headers);
        res.status(response.status || 200).end();
        console.info('[stream] %s/%s head ok in %dms', source, name, Date.now() - startTime);
      } catch (err) {
        console.warn(
          '[stream] head failed %s/%s: %s',
          source,
          name,
          err.message,
          {
            status: err.response?.status,
            code: err.code
          }
        );
        res.status(502).end();
      }
      return;
    }

    if (req.method !== 'GET') {
      return res.sendStatus(405);
    }

    const channelId = channel.guideNumber || channel.tvg_id || channel.name;
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    let usageKey;
    let usageInterval;
    const touchViewer = async () => {
      usageKey = await registerUsage({ ip: String(ip), channelId: String(channelId), userAgent });
      touchUsage(usageKey);
    };
    const registerPersistentViewer = async () => {
      if (usageKey) return;
      usageKey = await registerUsage({ ip: String(ip), channelId: String(channelId), userAgent });
      usageInterval = setInterval(() => touchUsage(usageKey), 10000);
      const cleanup = () => {
        if (usageInterval) clearInterval(usageInterval);
        usageInterval = null;
        if (usageKey) unregisterUsage(usageKey);
        usageKey = null;
      };
      res.on('close', cleanup);
      res.on('finish', cleanup);
      res.on('error', cleanup);
    };

    try {
      const response = await axios.get(upstreamUrl, {
        responseType: 'stream',
        timeout: 15000
      });

      const responseUrl = response.request?.res?.responseUrl || upstreamUrl;
      const contentType = response.headers?.['content-type'] || '';
      if (isLikelyHlsPlaylist(contentType, responseUrl)) {
        // HLS playlist/key/segment requests are short-lived; keep session alive via touch + idle TTL.
        await touchViewer();
        const playlistBody = await readStreamToUtf8(response.data);
        const rewrittenBody = rewriteHlsPlaylist(playlistBody, responseUrl, req, source, name);
        const headers = { ...response.headers };
        delete headers['content-length'];
        delete headers['transfer-encoding'];
        res.set(headers);
        res.set('content-type', 'application/x-mpegURL');
        res.send(rewrittenBody);
        console.info('[stream] %s/%s playlist rewritten in %dms', source, name, Date.now() - startTime);
        return;
      }

      if (upstreamOverride) {
        await touchViewer();
      } else {
        // Non-HLS primary streaming response: unregister immediately on disconnect.
        await registerPersistentViewer();
      }

      response.data.on('error', err => {
        console.warn('[stream] upstream error %s/%s: %s', source, name, err.message);
        res.destroy(err);
      });

      res.set(response.headers);
      response.data.pipe(res);
      console.info('[stream] %s/%s ready in %dms', source, name, Date.now() - startTime);
    } catch (err) {
      if (usageKey && !upstreamOverride) unregisterUsage(usageKey);
      if (usageInterval) clearInterval(usageInterval);
      console.warn(
        '[stream] failed %s/%s: %s',
        source,
        name,
        err.message,
        {
          status: err.response?.status,
          code: err.code
        }
      );
      res.status(502).send('Failed to fetch stream');
    }
  });
}

// Export cache invalidation function
export { invalidateCaches as invalidateLineupCaches };
