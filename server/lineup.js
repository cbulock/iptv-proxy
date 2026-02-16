import fs from 'fs';
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
    const channels = loadChannels();

    const channel = channels.find(
      c => c.source === source && c.name === name
    );

    if (!channel) return res.status(404).send('Channel not found');

    const startTime = Date.now();
    console.info('[stream] %s/%s -> %s', source, name, channel.original_url);

    if (req.method === 'HEAD') {
      try {
        const response = await axios.head(channel.original_url, { timeout: 5000 });
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
      if (usageKey) return;
      const channelId = channel.guideNumber || channel.tvg_id || channel.name;
      const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
      usageKey = await registerUsage({ ip: String(ip), channelId: String(channelId) });
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
      const response = await axios.get(channel.original_url, {
        responseType: 'stream',
        timeout: 15000
      });

      await registerViewer();

      response.data.on('error', err => {
        console.warn('[stream] upstream error %s/%s: %s', source, name, err.message);
        res.destroy(err);
      });

      res.set(response.headers);
      response.data.pipe(res);
      console.info('[stream] %s/%s ready in %dms', source, name, Date.now() - startTime);
    } catch (err) {
      if (usageKey) unregisterUsage(usageKey);
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
