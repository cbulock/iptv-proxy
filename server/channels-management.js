import express from 'express';
import fs from 'fs/promises';
import yaml from 'yaml';
import { loadConfig, validateConfigData } from '../libs/config-loader.js';
import { getConfigPath } from '../libs/paths.js';
import { parseAll } from '../scripts/parseM3U.js';
import { invalidateCache } from '../libs/channels-cache.js';
import rateLimit from 'express-rate-limit';
import { requireAuth } from './auth.js';

const router = express.Router();
const CHANNEL_MAP_PATH = getConfigPath('channel-map.yaml');

// Rate limiter for all authenticated channel management routes
const channelsAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute window
  max: 300, // limit each IP to 300 requests per windowMs for this router
});

// Apply rate limiting and authentication to all routes in this router
// Note: This router is mounted at /api/channels in index.js,
// so router.use(...) without a path applies to all routes
router.use(channelsAuthLimiter);
router.use(requireAuth);

function isSafeChannelKey(key) {
  return (
    typeof key === 'string' &&
    key !== '__proto__' &&
    key !== 'constructor' &&
    key !== 'prototype'
  );
}
// Rate limiter for write-heavy channel management operations
const channelsWriteLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 30, // limit each IP to 30 write requests per windowMs
});

/**
 * Reorder channels by updating their guide numbers
 * POST /api/channels/reorder
 * Body: { channels: [{ name: string, number: string }] }
 */
router.post('/reorder', channelsWriteLimiter, async (req, res) => {
  try {
    const { channels } = req.body;
    
    if (!Array.isArray(channels)) {
      return res.status(400).json({ error: 'channels must be an array' });
    }
    
    // Load current mapping
    let mapping = {};
    try {
      mapping = loadConfig('channelMap');
    } catch {}
    
    // Update guide numbers for specified channels
    let updated = 0;
    for (const ch of channels) {
      if (!ch.name) continue;
      if (!isSafeChannelKey(ch.name)) {
        return res.status(400).json({ error: 'Invalid channel name' });
      }
      
      if (!mapping[ch.name]) {
        mapping[ch.name] = {};
      }
      
      mapping[ch.name].number = String(ch.number || '');
      updated++;
    }
    
    // Validate and save
    const validation = validateConfigData('channelMap', mapping);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    const yamlText = yaml.stringify(validation.value || {});
    await fs.writeFile(CHANNEL_MAP_PATH, yamlText, 'utf8');
    
    // Reload channels
    await parseAll();
    await invalidateCache();
    
    res.json({ 
      status: 'success', 
      message: `Reordered ${updated} channels`,
      updated 
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder channels', detail: err.message });
  }
});

/**
 * Rename channels by updating their display names
 * POST /api/channels/rename
 * Body: { channels: [{ oldName: string, newName: string }] }
 */
router.post('/rename', channelsWriteLimiter, async (req, res) => {
  try {
    const { channels } = req.body;
    
    if (!Array.isArray(channels)) {
      return res.status(400).json({ error: 'channels must be an array' });
    }
    
    // Load current mapping
    let mapping = {};
    try {
      mapping = loadConfig('channelMap');
    } catch {}
    
    // Rename channels
    let updated = 0;
    for (const ch of channels) {
      if (!ch.oldName || !ch.newName) continue;
      
      // If there was an existing mapping for oldName, migrate it to newName
      if (mapping[ch.oldName]) {
        // Move the mapping to the new key and update the display name
        mapping[ch.newName] = {
          ...mapping[ch.oldName],
          name: ch.newName
        };
        delete mapping[ch.oldName];
      } else {
        // Create new mapping: the key is the source channel name (oldName),
        // and 'name' field overrides the display name to newName
        mapping[ch.oldName] = {
          name: ch.newName
        };
      }
      
      updated++;
    }
    
    // Validate and save
    const validation = validateConfigData('channelMap', mapping);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    const yamlText = yaml.stringify(validation.value || {});
    await fs.writeFile(CHANNEL_MAP_PATH, yamlText, 'utf8');
    
    // Reload channels
    await parseAll();
    await invalidateCache();
    
    res.json({ 
      status: 'success', 
      message: `Renamed ${updated} channels`,
      updated 
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename channels', detail: err.message });
  }
});

/**
 * Update channel groups (via group-title in M3U)
 * POST /api/channels/group
 * Body: { channels: [{ name: string, group: string }] }
 * Note: This updates the source group, not the mapping
 */
router.post('/group', channelsWriteLimiter, async (req, res) => {
  try {
    const { channels } = req.body;
    
    if (!Array.isArray(channels)) {
      return res.status(400).json({ error: 'channels must be an array' });
    }
    
    // Load current mapping
    let mapping = {};
    try {
      mapping = loadConfig('channelMap');
    } catch {}
    
    // Update groups
    let updated = 0;
    for (const ch of channels) {
      if (!ch.name || !isSafeChannelKey(ch.name)) continue;
      
      if (!mapping[ch.name]) {
        mapping[ch.name] = {};
      }
      
      mapping[ch.name].group = String(ch.group || '');
      updated++;
    }
    
    // Validate and save
    const validation = validateConfigData('channelMap', mapping);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    const yamlText = yaml.stringify(validation.value || {});
    await fs.writeFile(CHANNEL_MAP_PATH, yamlText, 'utf8');
    
    // Reload channels
    await parseAll();
    await invalidateCache();
    
    res.json({ 
      status: 'success', 
      message: `Updated groups for ${updated} channels`,
      updated 
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update groups', detail: err.message });
  }
});

/**
 * Bulk update channels (combine reorder, rename, group operations)
 * POST /api/channels/bulk-update
 * Body: { channels: [{ name: string, newName?: string, number?: string, group?: string }] }
 */
router.post('/bulk-update', channelsWriteLimiter, async (req, res) => {
  try {
    const { channels } = req.body;
    
    if (!Array.isArray(channels)) {
      return res.status(400).json({ error: 'channels must be an array' });
    }
    
    // Load current mapping
    let mapping = {};
    try {
      mapping = loadConfig('channelMap');
    } catch {}
    
    // Apply updates
    let updated = 0;
    for (const ch of channels) {
      if (!ch.name) continue;
      
      const targetKey = ch.newName || ch.name;
      
      if (!isSafeChannelKey(ch.name) || !isSafeChannelKey(targetKey)) {
        return res.status(400).json({ error: 'Invalid channel name' });
      }
      
      // Migrate existing mapping if renaming
      if (ch.newName && ch.name !== ch.newName && mapping[ch.name]) {
        mapping[targetKey] = { ...mapping[ch.name] };
        delete mapping[ch.name];
      }
      
      if (!mapping[targetKey]) {
        mapping[targetKey] = {};
      }
      
      // Apply updates
      if (ch.newName) mapping[targetKey].name = ch.newName;
      if (ch.number !== undefined) mapping[targetKey].number = String(ch.number);
      if (ch.group !== undefined) mapping[targetKey].group = String(ch.group);
      
      updated++;
    }
    
    // Validate and save
    const validation = validateConfigData('channelMap', mapping);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    const yamlText = yaml.stringify(validation.value || {});
    await fs.writeFile(CHANNEL_MAP_PATH, yamlText, 'utf8');
    
    // Reload channels
    await parseAll();
    await invalidateCache();
    
    res.json({ 
      status: 'success', 
      message: `Updated ${updated} channels`,
      updated 
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to bulk update channels', detail: err.message });
  }
});

export default router;
