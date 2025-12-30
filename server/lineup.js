import fs from 'fs';
import axios from 'axios';
import { getProxiedImageUrl } from '../libs/proxy-image.js';
import getBaseUrl from '../libs/getBaseUrl.js';
import { getChannels } from '../libs/channels-cache.js';
import { asyncHandler, AppError } from './error-handler.js';

// Cache for M3U output by host+protocol
const m3uCache = new Map();
const jsonCache = new Map();

// Invalidate caches when channels are updated
let lastChannelsUpdate = Date.now();

function invalidateCaches() {
  m3uCache.clear();
  jsonCache.clear();
  lastChannelsUpdate = Date.now();
}

export function setupLineupRoutes(app, config, usageHelpers = {}) {
  const {
    registerUsage = async () => undefined,
    touchUsage = () => undefined,
    unregisterUsage = () => undefined
  } = usageHelpers;
  const loadChannels = () => getChannels();

  app.get('/lineup.json', asyncHandler(async (req, res) => {
    try {
      const cacheKey = `${req.protocol}://${req.get('host')}`;
      
      // Check cache
      if (jsonCache.has(cacheKey)) {
        return res.json(jsonCache.get(cacheKey));
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
    } catch (err) {
      console.error('[lineup.json] Error generating lineup:', err.message);
      throw new AppError('Failed to generate lineup', 500, err.message);
    }
  }));

  app.get('/lineup.m3u', asyncHandler(async (req, res) => {
    try {
      // Extract query parameters for filtering
      const filterSource = req.query.source ? String(req.query.source) : null;
      const filterGroup = req.query.group ? String(req.query.group) : null;
      
      // Create cache key including filters
      const cacheKey = `${req.protocol}://${req.get('host')}|source:${filterSource || ''}|group:${filterGroup || ''}`;
      
      // Check cache
      if (m3uCache.has(cacheKey)) {
        res.set('Content-Type', 'application/x-mpegURL');
        return res.send(m3uCache.get(cacheKey));
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
    } catch (err) {
      console.error('[lineup.m3u] Error generating M3U:', err.message);
      throw new AppError('Failed to generate M3U playlist', 500, err.message);
    }
  }));

  app.all('/stream/:source/:name', async (req, res) => {
    const { source, name } = req.params;
    const channels = loadChannels();

    const channel = channels.find(
      c => c.source === source && c.name === name
    );

    if (!channel) return res.status(404).send('Channel not found');

    const startTime = Date.now();
    console.info(`[stream] ${source}/${name} -> ${channel.original_url}`);

    if (req.method === 'HEAD') {
      try {
        const response = await axios.head(channel.original_url, { timeout: 5000 });
        res.set(response.headers);
        res.status(response.status || 200).end();
        console.info(`[stream] ${source}/${name} head ok in ${Date.now() - startTime}ms`);
      } catch (err) {
        console.warn(
          `[stream] head failed ${source}/${name}: ${err.message}`,
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
        console.warn(`[stream] upstream error ${source}/${name}: ${err.message}`);
        res.destroy(err);
      });

      res.set(response.headers);
      response.data.pipe(res);
      console.info(`[stream] ${source}/${name} ready in ${Date.now() - startTime}ms`);
    } catch (err) {
      if (usageKey) unregisterUsage(usageKey);
      if (usageInterval) clearInterval(usageInterval);
      console.warn(
        `[stream] failed ${source}/${name}: ${err.message}`,
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
