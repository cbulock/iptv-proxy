import axios from 'axios';
import { getProxiedImageUrl } from '../libs/proxy-image.js';
import getBaseUrl from '../libs/getBaseUrl.js';
import { getChannels } from '../libs/channels-cache.js';
import { asyncHandler, AppError } from './error-handler.js';
import cacheManager from '../libs/cache-manager.js';
import { loadConfig } from '../libs/config-loader.js';

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

export function setupLineupRoutes(app, config, usageHelpers = {}) {
  // Initialize lineup caches with TTL from config (default: 1 hour)
  const appConfig = loadConfig('app');
  const m3uTTL = (appConfig.cache?.m3u_ttl ?? 3600) * 1000; // Convert seconds to milliseconds
  m3uCache = cacheManager.createCache('m3u', m3uTTL);
  jsonCache = cacheManager.createCache('lineup-json', m3uTTL);
  console.log(`Lineup caches initialized with TTL: ${m3uTTL / 1000}s`);

  const {
    registerUsage = async () => undefined,
    touchUsage = () => undefined
  } = usageHelpers;
  const loadChannels = () => getChannels();

  app.get('/lineup.json', asyncHandler(async (req, res) => {
    const cacheKey = `${req.protocol}://${req.get('host')}`;
    
    // Check cache
    const cached = jsonCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    const channels = loadChannels();
    
    // Validate that we have channels
    if (!Array.isArray(channels)) {
      throw new AppError('Invalid channels data structure', 500);
    }

    const baseUrl = getBaseUrl(req);
    const lineup = channels
      .filter(channel => channel && channel.name) // Filter out invalid channels
      .map(channel => ({
        GuideNumber: channel.guideNumber || channel.tvg_id || channel.name,
        GuideName: channel.name,
        URL: `${baseUrl}/stream/${encodeURIComponent(channel.source || 'unknown')}/${encodeURIComponent(channel.name)}`
      }));

    // Cache the result
    jsonCache.set(cacheKey, lineup);
    
    res.json(lineup);
  }));

  app.get('/lineup.m3u', asyncHandler(async (req, res) => {
    // Extract query parameters for filtering
    const filterSource = req.query.source ? String(req.query.source) : null;
    const filterGroup = req.query.group ? String(req.query.group) : null;
    
    // Create cache key including filters
    const cacheKey = `${req.protocol}://${req.get('host')}|source:${filterSource || ''}|group:${filterGroup || ''}`;
    
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
        const groupTitle = channel.source || '';
        const streamUrl = `${baseUrl}/stream/${encodeURIComponent(channel.source)}/${encodeURIComponent(channel.name)}`;

        output += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${tvgName}" tvg-logo="${tvgLogo}" group-title="${groupTitle}",${tvgName}\n`;
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

    const upstreamUrl = upstreamOverride || channel.original_url;
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

    let usageKey;
    let usageInterval;
    const registerViewer = async () => {
      const channelId = channel.guideNumber || channel.tvg_id || channel.name;
      const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';

      if (upstreamOverride) {
        usageKey = await registerUsage({ ip: String(ip), channelId: String(channelId) });
        touchUsage(usageKey);
        return;
      }

      if (usageKey) return;
      usageKey = await registerUsage({ ip: String(ip), channelId: String(channelId) });
      usageInterval = setInterval(() => touchUsage(usageKey), 10000);
      const cleanup = () => {
        if (usageInterval) clearInterval(usageInterval);
        usageInterval = null;
        if (usageKey) touchUsage(usageKey);
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

      await registerViewer();

      const responseUrl = response.request?.res?.responseUrl || upstreamUrl;
      const contentType = response.headers?.['content-type'] || '';
      if (isLikelyHlsPlaylist(contentType, responseUrl)) {
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

      response.data.on('error', err => {
        console.warn('[stream] upstream error %s/%s: %s', source, name, err.message);
        res.destroy(err);
      });

      res.set(response.headers);
      response.data.pipe(res);
      console.info('[stream] %s/%s ready in %dms', source, name, Date.now() - startTime);
    } catch (err) {
      if (usageKey) touchUsage(usageKey);
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
