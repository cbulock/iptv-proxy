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
  skip: req => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: req => req.ip || 'unknown',
});

// M3U and JSON lineup caches
let m3uCache = null;
let jsonCache = null;

// Cache the most-recently-served HLS manifest response URL for each channel.
// When a channel's configured URL redirects to a different origin (e.g., http://host:8000 →
// https://host via a reverse proxy), HLS segment URLs are resolved against the redirected
// URL. This cache lets the ?upstream= origin validator accept those segment URLs even though
// they don't share an origin with channel.original_url.
const hlsManifestOriginCache = new Map();

function invalidateCaches() {
  if (m3uCache) m3uCache.clear();
  if (jsonCache) jsonCache.clear();
}

function isLikelyHlsPlaylist(contentType = '', upstreamUrl = '') {
  const normalizedContentType = String(contentType).toLowerCase();

  // Explicit HLS content types are authoritative — always treat as playlist.
  if (
    normalizedContentType.includes('application/vnd.apple.mpegurl') ||
    normalizedContentType.includes('application/x-mpegurl') ||
    normalizedContentType.includes('audio/mpegurl') ||
    normalizedContentType.includes('audio/x-mpegurl')
  ) {
    return true;
  }

  // Explicit non-HLS media content types are authoritative — never buffer as playlist.
  // This prevents hanging when an HDHomeRun device returns raw MPEG-TS (video/mp2t) with
  // HTTP 200 instead of 503 when HLS is requested but unsupported.
  if (normalizedContentType.startsWith('video/') || normalizedContentType.startsWith('audio/')) {
    return false;
  }

  // When content-type is absent or generic (e.g. application/octet-stream), fall back to
  // URL-based hints to detect playlists requested with ?streamMode=hls or a .m3u8 path.
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
  let totalBytes = 0;
  const maxBytes = 1 * 1024 * 1024; // 1 MB — no valid HLS playlist exceeds this
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > maxBytes) {
      // Stream is too large to be a text playlist; abort to avoid buffering a continuous feed.
      throw new Error('Response exceeds maximum playlist size (1 MB); not an HLS playlist');
    }
    chunks.push(buf);
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
  // HDHomeRun channels come from a hardware tuner and are always included
  // without requiring an explicit channel-map entry.
  if (channel?.hdhomerun) return true;

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

/**
 * Check that overrideUrlString uses HTTP(S) and shares the same origin
 * (protocol + hostname + port) as channelUrlString.
 * @returns {{ ok: boolean, reason?: string }}
 */
function isSameOriginHttpUrl(overrideUrlString, channelUrlString) {
  const defaultPorts = { 'http:': '80', 'https:': '443' };
  const normalizePort = url => url.port || defaultPorts[url.protocol];

  let overrideUrl;
  let channelUrl;
  try {
    overrideUrl = new URL(overrideUrlString);
    channelUrl = new URL(channelUrlString);
  } catch (_err) {
    return { ok: false, reason: 'parse-error' };
  }

  // Only allow HTTP(S) schemes for both URLs.
  if (!defaultPorts[overrideUrl.protocol] || !defaultPorts[channelUrl.protocol]) {
    return { ok: false, reason: 'invalid-protocol' };
  }

  const sameOrigin =
    overrideUrl.protocol === channelUrl.protocol &&
    overrideUrl.hostname === channelUrl.hostname &&
    normalizePort(overrideUrl) === normalizePort(channelUrl);

  return sameOrigin ? { ok: true } : { ok: false, reason: 'origin-mismatch' };
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
    unregisterUsage = () => undefined,
  } = usageHelpers;
  const loadChannels = () => getChannels();

  app.get(
    '/lineup.json',
    lineupLimiter,
    asyncHandler(async (req, res) => {
      const includeUnmapped = parseBooleanQueryParam(
        req.query.include_unmapped ?? req.query.includeUnmapped
      );
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
          URL: `${baseUrl}/stream/${encodeURIComponent(channel.source || 'unknown')}/${encodeURIComponent(channel.name)}`,
        }));

      // Cache the result
      jsonCache.set(cacheKey, lineup);

      res.json(lineup);
    })
  );

  app.get(
    '/lineup.m3u',
    lineupLimiter,
    asyncHandler(async (req, res) => {
      // Extract query parameters for filtering
      const filterSource = req.query.source ? String(req.query.source) : null;
      const filterGroup = req.query.group ? String(req.query.group) : null;
      const includeUnmapped = parseBooleanQueryParam(
        req.query.include_unmapped ?? req.query.includeUnmapped
      );

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
    })
  );

  app.all('/stream/:source/:name', async (req, res) => {
    const { source, name } = req.params;
    const upstreamOverride = req.query.upstream ? String(req.query.upstream) : null;
    const channels = loadChannels();

    const channel = channels.find(c => c.source === source && c.name === name);

    if (!channel) return res.status(404).send('Channel not found');

    // Validate the ?upstream= override to prevent SSRF: only allow fetching from the same
    // HTTP(S) origin (protocol + hostname + port) as the channel's configured upstream URL.
    // We also accept the origin of the last-known HLS manifest response URL for this channel
    // (see hlsManifestOriginCache) to handle cases where channel.original_url redirects to a
    // different origin (e.g., http://host:8000 → https://host via a reverse proxy).
    if (upstreamOverride) {
      let result = isSameOriginHttpUrl(upstreamOverride, channel.original_url);

      // When the origin doesn't match the configured URL, fall back to the cached redirect
      // target. Only attempt this for origin-mismatch (not parse/protocol errors).
      if (!result.ok && result.reason === 'origin-mismatch') {
        const cachedResponseUrl = hlsManifestOriginCache.get(`${source}/${name}`);
        if (cachedResponseUrl) {
          result = isSameOriginHttpUrl(upstreamOverride, cachedResponseUrl);
        }
      }

      if (!result.ok) {
        if (result.reason === 'parse-error') {
          return res.status(400).send('Invalid upstream URL');
        }
        if (result.reason === 'invalid-protocol') {
          return res.status(403).send('Upstream URL protocol not allowed');
        }
        // origin-mismatch or any other reason
        return res.status(403).send('Upstream URL not allowed');
      }

      // Additional SSRF hardening: ensure the override uses a permitted scheme.
      if (!isSafePublicHttpUrl(upstreamOverride)) {
        return res.status(403).send('Upstream URL not allowed');
      }
    }

    let upstreamUrl = upstreamOverride || channel.original_url;

    // When the client explicitly requests HLS mode (e.g. browser preview with
    // ?streamMode=hls) and the channel comes from an HDHomeRun tuner, ask the
    // device to transcode the over-the-air MPEG-TS to an HLS stream.  Without
    // this, OTA broadcasts typically use MPEG-2 video and AC-3 audio — codecs
    // that browser MSE does not support — so the player receives data but cannot
    // decode any frames.  Do not apply this for ?upstream= segment requests;
    // those are already resolved segment URLs that must be fetched as-is.
    const requestedHlsMode =
      !upstreamOverride &&
      Boolean(channel.hdhomerun) &&
      String(req.query.streamMode || '').toLowerCase() === 'hls';

    if (requestedHlsMode) {
      try {
        const hdUrl = new URL(upstreamUrl);
        hdUrl.searchParams.set('streamMode', 'hls');
        upstreamUrl = hdUrl.toString();
      } catch (_err) {
        // URL parse error; proceed with original URL without modification
        console.warn('[stream] %s/%s: could not append ?streamMode=hls to upstream URL: %s', source, name, channel.original_url);
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
        console.warn('[stream] head failed %s/%s: %s', source, name, err.message, {
          status: err.response?.status,
          code: err.code,
        });
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

    const handleStreamResponse = async (response, resolvedUrl, isUpstreamOverride) => {
      const responseUrl = response.request?.res?.responseUrl || resolvedUrl;
      const contentType = response.headers?.['content-type'] || '';
      // Determine whether the upstream response is an HLS playlist:
      //
      // • requestedHlsMode (HDHomeRun + client sent ?streamMode=hls): check only the
      //   Content-Type header — never URL hints.  We appended ?streamMode=hls to the
      //   upstream URL, so isLikelyHlsPlaylist's URL-based heuristic would always fire,
      //   even when older firmware returns raw MPEG-TS at that URL and hits the 1 MB cap.
      //
      // • All other cases (including default HDHomeRun pass-through): preserve the
      //   existing !channel.hdhomerun guard that bypasses HLS detection entirely for
      //   HDHomeRun channels, preventing readStreamToUtf8 from buffering a continuous
      //   MPEG-TS feed when firmware redirects to an .m3u8-named URL.
      const isHlsResponse = requestedHlsMode
        // Content-type only (empty URL disables the URL-hint path inside isLikelyHlsPlaylist).
        // URL hints are intentionally skipped here: we appended ?streamMode=hls to the
        // upstream URL, so those hints would always match regardless of the actual format.
        ? isLikelyHlsPlaylist(contentType, '')
        : !channel.hdhomerun && isLikelyHlsPlaylist(contentType, responseUrl);

      if (isHlsResponse) {
        // HLS playlist/key/segment requests are short-lived; keep session alive via touch + idle TTL.
        await touchViewer();
        const playlistBody = await readStreamToUtf8(response.data);
        const rewrittenBody = rewriteHlsPlaylist(playlistBody, responseUrl, req, source, name);
        const headers = { ...response.headers };
        delete headers['content-length'];
        delete headers['transfer-encoding'];

        // Remember the effective origin of this manifest so that segment ?upstream= requests
        // can be validated against it.  This is necessary when channel.original_url redirects
        // to a different origin (e.g., http://host:8000 → https://host via a reverse proxy):
        // the rewritten segment URLs will carry the redirected origin, not original_url's.
        if (!isUpstreamOverride) {
          hlsManifestOriginCache.set(`${source}/${name}`, responseUrl);
        }

        res.set(headers);
        res.set('content-type', 'application/x-mpegURL');
        res.send(rewrittenBody);
        console.info(
          '[stream] %s/%s playlist rewritten in %dms',
          source,
          name,
          Date.now() - startTime
        );
        return;
      }

      if (isUpstreamOverride) {
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
    };

    try {
      // When an ?upstream= override is in use, disable redirects to prevent SSRF via open
      // redirects: the origin check above validates the initial URL but can't guard against
      // a server-side redirect to a different host.
      const axiosOptions = {
        responseType: 'stream',
        timeout: 15000,
        ...(upstreamOverride ? { maxRedirects: 0 } : {}),
      };
      const response = await axios.get(upstreamUrl, axiosOptions);

      await handleStreamResponse(response, upstreamUrl, !!upstreamOverride);
    } catch (err) {
      if (usageKey && !upstreamOverride) unregisterUsage(usageKey);
      if (usageInterval) clearInterval(usageInterval);
      console.warn('[stream] failed %s/%s: %s', source, name, err.message, {
        status: err.response?.status,
        code: err.code,
      });
      res.status(502).send('Failed to fetch stream');
    }
  });
}

function isSafePublicHttpUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return false;
  }

  return true;
}

// Export cache invalidation function
export { invalidateCaches as invalidateLineupCaches };
