import fs from 'fs';
import express from 'express';
import yaml from 'yaml';
import { parseAll } from '../scripts/parseM3U.js';
import { refreshEPG } from './epg.js';
import fsPromises from 'fs/promises';
import { loadConfig, validateConfigData } from '../libs/config-loader.js';
import { invalidateCache, getChannels } from '../libs/channels-cache.js';

const router = express.Router();

const M3U_PATH = './config/m3u.yaml';
const EPG_PATH = './config/epg.yaml';
const APP_PATH = './config/app.yaml';
const CHANNEL_MAP_PATH = './config/channel-map.yaml';

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
    res.status(500).json({ error: 'Failed to read m3u.yaml', detail: e.message });
  }
});

router.get('/api/config/epg', (req, res) => {
  try {
    res.json(loadEPG());
  } catch (e) {
    res.status(500).json({ error: 'Failed to read epg.yaml', detail: e.message });
  }
});

router.get('/api/config/app', (req, res) => {
  try {
    res.json(loadAPP());
  } catch (e) {
    res.status(500).json({ error: 'Failed to read app.yaml', detail: e.message });
  }
});

router.get('/api/config/channel-map', (req, res) => {
  try {
    res.json(loadChannelMap());
  } catch (e) {
    res.status(500).json({ error: 'Failed to read channel-map.yaml', detail: e.message });
  }
});

router.put('/api/config/m3u', (req, res) => {
  const incoming = req.body;
  const validation = validateConfigData('m3u', incoming);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  try {
    const yamlText = yaml.stringify(validation.value);
    fs.writeFileSync(M3U_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write m3u.yaml', detail: e.message });
  }
});

router.put('/api/config/epg', (req, res) => {
  const incoming = req.body;
  const validation = validateConfigData('epg', incoming);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  try {
    const yamlText = yaml.stringify(validation.value);
    fs.writeFileSync(EPG_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write epg.yaml', detail: e.message });
  }
});

router.put('/api/config/app', (req, res) => {
  const incoming = req.body;
  const validation = validateConfigData('app', incoming);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  try {
    const yamlText = yaml.stringify(validation.value || {});
    fs.writeFileSync(APP_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write app.yaml', detail: e.message });
  }
});

router.put('/api/config/channel-map', (req, res) => {
  const incoming = req.body || {};
  const validation = validateConfigData('channelMap', incoming);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  try {
    const yamlText = yaml.stringify(validation.value || {});
    fs.writeFileSync(CHANNEL_MAP_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write channel-map.yaml', detail: e.message });
  }
});

router.post('/api/reload/channels', async (req, res) => {
  try {
    const count = await parseAll();
    await invalidateCache();
    res.json({ status: 'reloaded', channels: count });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reload channels', detail: e.message });
  }
});

router.post('/api/reload/epg', async (req, res) => {
  try {
    await refreshEPG();
    res.json({ status: 'reloaded' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reload EPG', detail: e.message });
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

export default router;
