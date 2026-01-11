import fs from 'fs';
import express from 'express';
import yaml from 'yaml';
import RateLimit from 'express-rate-limit';
import { parseAll } from '../scripts/parseM3U.js';
import { refreshEPG } from './epg.js';
import fsPromises from 'fs/promises';
import { loadConfig, validateConfigData } from '../libs/config-loader.js';
import { invalidateCache, getChannels } from '../libs/channels-cache.js';
import { getConfigPath } from '../libs/paths.js';

const router = express.Router();

// Rate limiter for configuration write endpoints to mitigate DoS via repeated disk writes
const configWriteLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // limit each IP to 30 config write requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many configuration updates from this IP, please try again later.',
  },
});

// Rate limiter for write operations (more restrictive)
const writeLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
});

// Rate limiter for read operations (less restrictive)
const readLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

const M3U_PATH = getConfigPath('m3u.yaml');
const EPG_PATH = getConfigPath('epg.yaml');
const APP_PATH = getConfigPath('app.yaml');
const CHANNEL_MAP_PATH = getConfigPath('channel-map.yaml');

function loadM3U() {
  return loadConfig('m3u');
}

function loadEPG() {
  return loadConfig('epg');
}

function loadAPP() {
  return loadConfig('app');
}

function loadChannelMap() {
  return loadConfig('channelMap');
}

router.get('/api/config/m3u', (req, res) => {
  try {
    res.json(loadM3U());
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to read m3u.yaml', 
      detail: e.message,
      fix: 'Check that m3u.yaml exists in the config directory and is valid YAML. See config/examples/m3u.example.yaml for reference.'
    });
  }
});

router.get('/api/config/epg', (req, res) => {
  try {
    res.json(loadEPG());
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to read epg.yaml', 
      detail: e.message,
      fix: 'Check that epg.yaml exists in the config directory and is valid YAML. See config/examples/epg.example.yaml for reference.'
    });
  }
});

router.get('/api/config/app', (req, res) => {
  try {
    res.json(loadAPP());
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to read app.yaml', 
      detail: e.message,
      fix: 'Check that app.yaml exists in the config directory and is valid YAML. See config/examples/app.example.yaml for reference.'
    });
  }
});

router.get('/api/config/channel-map', (req, res) => {
  try {
    res.json(loadChannelMap());
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to read channel-map.yaml', 
      detail: e.message,
      fix: 'Check that channel-map.yaml exists in the config directory and is valid YAML. See config/examples/channel-map.example.yaml for reference.'
    });
  }
});

router.put('/api/config/m3u', configWriteLimiter, (req, res) => {
  const incoming = req.body;
  const validation = validateConfigData('m3u', incoming);
  if (!validation.valid) return res.status(400).json({ 
    error: validation.error,
    fix: 'Ensure all M3U sources have required fields: name (string) and url (string). The type field is optional and defaults to "m3u". See config/examples/m3u.example.yaml for examples.'
  });
  try {
    const yamlText = yaml.stringify(validation.value);
    fs.writeFileSync(M3U_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to write m3u.yaml', 
      detail: e.message,
      fix: 'Check file permissions on the config directory and ensure disk space is available.'
    });
  }
});

router.put('/api/config/epg', configWriteLimiter, (req, res) => {
  const incoming = req.body;
  const validation = validateConfigData('epg', incoming);
  if (!validation.valid) return res.status(400).json({ 
    error: validation.error,
    fix: 'Ensure all EPG sources have required fields: name (string) and url (string). URLs can be HTTP(S) or file:// paths. See config/examples/epg.example.yaml for examples.'
  });
  try {
    const yamlText = yaml.stringify(validation.value);
    fs.writeFileSync(EPG_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to write epg.yaml', 
      detail: e.message,
      fix: 'Check file permissions on the config directory and ensure disk space is available.'
    });
  }
});

router.put('/api/config/app', configWriteLimiter, (req, res) => {
  const incoming = req.body;
  const validation = validateConfigData('app', incoming);
  if (!validation.valid) return res.status(400).json({ 
    error: validation.error,
    fix: 'The base_url field must be a valid URL if provided. See config/examples/app.example.yaml for examples and scheduler configuration.'
  });
  try {
    const yamlText = yaml.stringify(validation.value || {});
    fs.writeFileSync(APP_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to write app.yaml', 
      detail: e.message,
      fix: 'Check file permissions on the config directory and ensure disk space is available.'
    });
  }
});

router.put('/api/config/channel-map', configWriteLimiter, (req, res) => {
  const incoming = req.body || {};
  const validation = validateConfigData('channelMap', incoming);
  if (!validation.valid) return res.status(400).json({ 
    error: validation.error,
    fix: 'Channel mappings must have at least one property: name, number, tvg_id, logo, or url. Keys should match channel names or tvg_ids from your sources. See config/examples/channel-map.example.yaml for examples.'
  });
  try {
    const yamlText = yaml.stringify(validation.value || {});
    fs.writeFileSync(CHANNEL_MAP_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to write channel-map.yaml', 
      detail: e.message,
      fix: 'Check file permissions on the config directory and ensure disk space is available.'
    });
  }
});

router.post('/api/reload/channels', async (req, res) => {
  try {
    const count = await parseAll();
    await invalidateCache();
    res.json({ status: 'reloaded', channels: count });
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to reload channels', 
      detail: e.message,
      fix: 'Check that all M3U sources in m3u.yaml are accessible. Review server logs for specific source errors. See README.md troubleshooting section for common issues.'
    });
  }
});

router.post('/api/reload/epg', async (req, res) => {
  try {
    await refreshEPG();
    res.json({ status: 'reloaded' });
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to reload EPG', 
      detail: e.message,
      fix: 'Check that all EPG sources in epg.yaml are accessible and contain valid XMLTV data. Verify channel IDs match between M3U and EPG. See README.md troubleshooting section.'
    });
  }
});

// Helper data endpoints for mapping UI
router.get('/api/mapping/candidates', async (req, res) => {
  try {
    const epg = loadEPG();
    const channels = getChannels();
    const tvgMap = new Map();
    for (const c of channels) {
      if (!c.tvg_id) continue;
      if (!tvgMap.has(c.tvg_id)) {
        tvgMap.set(c.tvg_id, c.name || c.tvg_id);
      }
    }
    const tvgIds = Array.from(tvgMap.keys()).sort();
    const tvgOptions = Array.from(tvgMap.entries())
      .map(([id, name]) => ({ value: id, label: `${name} (${id})` }))
      .sort((a, b) => a.label.localeCompare(b.label));
    // EPG display-names will come from merged XML normally; fall back to channel names grouped by source
    const epgNames = Array.from(new Set(channels.map(c => c.name))).sort();
    res.json({ epgNames, tvgIds, tvgOptions });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load candidates', detail: e.message });
  }
});

router.get('/api/mapping/unmapped', async (req, res) => {
  try {
    const map = loadChannelMap();
    const mapKeys = new Set(Object.keys(map || {}));
    const channels = getChannels();
    const filterSource = req.query.source ? String(req.query.source) : '';
    const suggestionsMap = new Map();
    for (const c of channels) {
      if (filterSource && c.source !== filterSource) continue;
      const name = c.name;
      const id = c.tvg_id || '';
      const keyHit = mapKeys.has(name) || (id && mapKeys.has(id));
      if (keyHit) continue;
      const k = `${name}|${id}|${c.source || ''}`;
      if (!suggestionsMap.has(k)) suggestionsMap.set(k, { name, tvg_id: id, source: c.source || '' });
    }
    const suggestions = Array.from(suggestionsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ suggestions, count: suggestions.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute unmapped', detail: e.message });
  }
});

// Dynamic mapping management endpoints

router.post('/api/mapping', writeLimiter, async (req, res) => {
  try {
    const { key, mapping } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ 
        error: 'Missing or invalid key',
        fix: 'The key must be a string matching a channel name or tvg_id from your sources. Example: { "key": "NBC Los Angeles", "mapping": { "number": "4.1", "tvg_id": "nbc.la" } }'
      });
    }
    if (!mapping || typeof mapping !== 'object') {
      return res.status(400).json({ 
        error: 'Missing or invalid mapping object',
        fix: 'The mapping must be an object with at least one property: name, number, tvg_id, logo, or url. Example: { "number": "4.1", "tvg_id": "nbc.la" }'
      });
    }
    
    // Load current mappings
    let channelMap = loadChannelMap();
    
    // Add or update the mapping
    channelMap[key] = {
      ...channelMap[key],
      ...mapping
    };
    
    // Save the updated mapping
    const yamlText = yaml.stringify(channelMap);
    fs.writeFileSync(CHANNEL_MAP_PATH, yamlText, 'utf8');
    
    res.json({ status: 'saved', key, mapping: channelMap[key] });
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to save mapping', 
      detail: e.message,
      fix: 'Check file permissions on channel-map.yaml and ensure disk space is available.'
    });
  }
});

router.delete('/api/mapping/:key', writeLimiter, async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    if (!key) {
      return res.status(400).json({ 
        error: 'Missing key',
        fix: 'Provide a channel name or tvg_id to delete. Example: DELETE /api/mapping/Channel%20Name'
      });
    }
    
    // Load current mappings
    let channelMap = loadChannelMap();
    
    // Check if key exists
    if (!channelMap[key]) {
      return res.status(404).json({ 
        error: 'Mapping not found',
        fix: `No mapping exists for key "${key}". Check the exact key name in your channel-map.yaml file.`
      });
    }
    
    // Remove the mapping
    delete channelMap[key];
    
    // Save the updated mapping
    const yamlText = yaml.stringify(channelMap);
    fs.writeFileSync(CHANNEL_MAP_PATH, yamlText, 'utf8');
    
    res.json({ status: 'deleted', key });
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to delete mapping', 
      detail: e.message,
      fix: 'Check file permissions on channel-map.yaml.'
    });
  }
});

router.post('/api/mapping/bulk', writeLimiter, async (req, res) => {
  try {
    const { mappings } = req.body;
    if (!mappings || typeof mappings !== 'object') {
      return res.status(400).json({ 
        error: 'Missing or invalid mappings object',
        fix: 'Provide an object with channel mappings. Example: { "mappings": { "Channel A": { "number": "1" }, "Channel B": { "number": "2" } } }'
      });
    }
    
    // Load current mappings
    let channelMap = loadChannelMap();
    
    // Merge the new mappings
    let count = 0;
    for (const [key, mapping] of Object.entries(mappings)) {
      if (typeof mapping === 'object' && mapping !== null) {
        channelMap[key] = {
          ...channelMap[key],
          ...mapping
        };
        count++;
      }
    }
    
    // Save the updated mapping
    const yamlText = yaml.stringify(channelMap);
    fs.writeFileSync(CHANNEL_MAP_PATH, yamlText, 'utf8');
    
    res.json({ status: 'saved', count });
  } catch (e) {
    res.status(500).json({ 
      error: 'Failed to save bulk mappings', 
      detail: e.message,
      fix: 'Check file permissions on channel-map.yaml and ensure disk space is available.'
    });
  }
});

export default router;
