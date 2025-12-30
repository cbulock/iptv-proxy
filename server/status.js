import express from 'express';
import fs from 'fs/promises';
import { loadConfig } from '../libs/config-loader.js';
import { getChannels } from '../libs/channels-cache.js';

const router = express.Router();
const CHANNELS_FILE = './data/channels.json';

// Track parsing errors and source status
let sourceStatus = {
  lastUpdate: null,
  sources: {},
  errors: []
};

/**
 * Update source status - to be called from parseM3U.js
 */
export function updateSourceStatus(sourceName, status, error = null) {
  sourceStatus.sources[sourceName] = {
    status, // 'success', 'error', 'pending'
    lastUpdate: new Date().toISOString(),
    error: error || null
  };
  sourceStatus.lastUpdate = new Date().toISOString();
  
  if (error) {
    sourceStatus.errors.push({
      source: sourceName,
      error: error,
      timestamp: new Date().toISOString()
    });
    // Keep only last 50 errors
    if (sourceStatus.errors.length > 50) {
      sourceStatus.errors = sourceStatus.errors.slice(-50);
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
    errors: []
  };
}

/**
 * GET /status - Comprehensive diagnostics endpoint
 */
router.get('/status', async (req, res) => {
  try {
    // Load configurations
    const m3uConfig = loadConfig('m3u');
    const epgConfig = loadConfig('epg');
    const channelMapConfig = loadConfig('channelMap');
    
    // Get current channels
    const channels = getChannels();
    
    // Get file stats
    let channelsFileStats = null;
    try {
      const stats = await fs.stat(CHANNELS_FILE);
      channelsFileStats = {
        size: stats.size,
        modified: stats.mtime.toISOString()
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
    const status = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      
      channels: {
        total: channels.length,
        bySource: channelsBySource,
        mapped: mappedCount,
        unmapped: unmappedCount,
        file: channelsFileStats
      },
      
      sources: {
        m3u: {
          count: m3uConfig.urls?.length || 0,
          configured: (m3uConfig.urls || []).map(s => ({
            name: s.name,
            type: s.type || 'standard',
            url: s.url
          })),
          status: sourceStatus.sources
        },
        epg: {
          count: epgConfig.urls?.length || 0,
          configured: (epgConfig.urls || []).map(s => ({
            name: s.name,
            url: s.url
          }))
        }
      },
      
      mappings: {
        total: Object.keys(channelMapConfig || {}).length,
        channelsCovered: mappedCount,
        channelsNotCovered: unmappedCount,
        coveragePercent: channels.length > 0 
          ? Math.round((mappedCount / channels.length) * 100) 
          : 0
      },
      
      parsing: {
        lastUpdate: sourceStatus.lastUpdate,
        recentErrors: sourceStatus.errors.slice(-10) // Last 10 errors
      }
    };
    
    res.json(status);
  } catch (err) {
    res.status(500).json({ 
      error: 'Failed to generate status', 
      detail: err.message 
    });
  }
});

export default router;
