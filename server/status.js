import express from 'express';
import fs from 'fs/promises';
import RateLimit from 'express-rate-limit';
import { loadChannelMapFromStore } from '../libs/channel-map-service.js';
import { getChannels } from '../libs/channels-cache.js';
import { loadProvidersConfigFromStore } from '../libs/source-service.js';

const router = express.Router();
const CHANNELS_FILE = './data/channels.json';

// Configuration constants
const MAX_ERROR_HISTORY = 50; // Maximum number of errors to keep in history
const RECENT_ERROR_LIMIT = 10; // Number of recent errors to show in status

// Rate limiter for status endpoint
const statusLimiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  skip: req => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: req => req.ip || 'unknown',
});

// Track parsing errors and source status
let sourceStatus = {
  lastUpdate: null,
  sources: {},
  errors: [],
};

/**
 * Update source status - to be called from parseM3U.js
 */
export function updateSourceStatus(sourceName, status, error = null) {
  sourceStatus.sources[sourceName] = {
    status, // 'success', 'error', 'pending'
    lastUpdate: new Date().toISOString(),
    error: error || null,
  };
  sourceStatus.lastUpdate = new Date().toISOString();

  if (error) {
    sourceStatus.errors.push({
      source: sourceName,
      error: error,
      timestamp: new Date().toISOString(),
    });
    // Keep only last MAX_ERROR_HISTORY errors
    if (sourceStatus.errors.length > MAX_ERROR_HISTORY) {
      sourceStatus.errors = sourceStatus.errors.slice(-MAX_ERROR_HISTORY);
    }
  }
}

/**
 * Reset source status
 */
export function resetSourceStatus() {
  sourceStatus = {
    lastUpdate: new Date().toISOString(),
    sources: {},
    errors: [],
  };
}

/**
 * Return the current source status snapshot (last update time and per-source state).
 * @returns {{ lastUpdate: string|null, sources: object, errors: Array }}
 */
export function getSourceStatus() {
  return {
    lastUpdate: sourceStatus.lastUpdate,
    sources: { ...sourceStatus.sources },
    errors: sourceStatus.errors.slice(-RECENT_ERROR_LIMIT),
  };
}

/**
 * GET /status - Comprehensive diagnostics endpoint
 */
router.get('/status', statusLimiter, async (req, res) => {
  try {
    // Load configurations
    const providersConfig = loadProvidersConfigFromStore();
    const channelMapConfig = loadChannelMapFromStore();

    // Get current channels
    const channels = getChannels();

    // Get file stats
    let channelsFileStats = null;
    try {
      const stats = await fs.stat(CHANNELS_FILE);
      channelsFileStats = {
        size: stats.size,
        modified: stats.mtime.toISOString(),
      };
    } catch (err) {
      // File doesn't exist yet
    }

    // Count channels by source
    const channelsBySource = {};
    for (const ch of channels) {
      const src = ch.source || 'unknown';
      channelsBySource[src] = (channelsBySource[src] || 0) + 1;
    }

    // Count mapped vs unmapped channels
    const mapKeys = new Set(Object.keys(channelMapConfig || {}));
    let mappedCount = 0;
    let unmappedCount = 0;
    for (const ch of channels) {
      const hasMapping = mapKeys.has(ch.name) || (ch.tvg_id && mapKeys.has(ch.tvg_id));
      if (hasMapping) {
        mappedCount++;
      } else {
        unmappedCount++;
      }
    }

    // Build response
    const configuredProviders = providersConfig.providers || [];
    const configuredEpgSources = configuredProviders
      .filter(provider => provider.epg)
      .map(provider => ({
        name: provider.name,
        url: provider.epg,
      }));

    const status = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),

      channels: {
        total: channels.length,
        bySource: channelsBySource,
        mapped: mappedCount,
        unmapped: unmappedCount,
        file: channelsFileStats,
      },

      sources: {
        m3u: {
          count: configuredProviders.length,
          configured: configuredProviders.map(provider => ({
            name: provider.name,
            type: provider.type || 'm3u',
            url: provider.url,
          })),
          status: sourceStatus.sources,
        },
        epg: {
          count: configuredEpgSources.length,
          configured: configuredEpgSources,
        },
      },

      mappings: {
        total: Object.keys(channelMapConfig || {}).length,
        channelsCovered: mappedCount,
        channelsNotCovered: unmappedCount,
        coveragePercent:
          channels.length > 0 ? Math.round((mappedCount / channels.length) * 100) : 0,
      },

      parsing: {
        lastUpdate: sourceStatus.lastUpdate,
        recentErrors: sourceStatus.errors.slice(-RECENT_ERROR_LIMIT), // Last N errors
      },
    };

    res.json(status);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to generate status',
      detail: err.message,
    });
  }
});

export default router;
