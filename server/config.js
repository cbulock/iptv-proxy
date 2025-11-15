import fs from 'fs';
import express from 'express';
import yaml from 'yaml';
import { parseAll } from '../scripts/parseM3U.js';
import { refreshEPG } from './epg.js';
import fsPromises from 'fs/promises';

const router = express.Router();

const M3U_PATH = './config/m3u.yaml';
const EPG_PATH = './config/epg.yaml';
const APP_PATH = './config/app.yaml';
const CHANNEL_MAP_PATH = './config/channel-map.yaml';

function loadM3U() {
  const text = fs.readFileSync(M3U_PATH, 'utf8');
  return yaml.parse(text) || {};
}

function loadEPG() {
  const text = fs.readFileSync(EPG_PATH, 'utf8');
  return yaml.parse(text) || {};
}

function loadAPP() {
  const text = fs.readFileSync(APP_PATH, 'utf8');
  return yaml.parse(text) || {};
}

function loadChannelMap() {
  if (!fs.existsSync(CHANNEL_MAP_PATH)) return {};
  const text = fs.readFileSync(CHANNEL_MAP_PATH, 'utf8');
  return yaml.parse(text) || {};
}

function validateM3U(obj) {
  if (!obj || typeof obj !== 'object') return 'Config root must be an object';
  if (!Array.isArray(obj.urls)) return 'Config must have an array property "urls"';
  for (const [i, u] of obj.urls.entries()) {
    if (!u.name) return `urls[${i}].name missing`;
    if (!u.url) return `urls[${i}].url missing`;
    if (u.type && !['m3u','hdhomerun'].includes(String(u.type).toLowerCase())) {
      return `urls[${i}].type must be one of: m3u, hdhomerun`;
    }
  }
  return null;
}

function validateEPG(obj) {
  if (!obj || typeof obj !== 'object') return 'Config root must be an object';
  if (!Array.isArray(obj.urls)) return 'Config must have an array property "urls"';
  for (const [i, u] of obj.urls.entries()) {
    if (!u.name) return `urls[${i}].name missing`;
    if (!u.url) return `urls[${i}].url missing`;
  }
  return null;
}

function validateAPP(obj) {
  if (!obj || typeof obj !== 'object') return 'Config root must be an object';
  if (obj.base_url !== undefined && typeof obj.base_url !== 'string') return 'base_url must be a string';
  return null;
}

function validateChannelMap(obj) {
  if (!obj || typeof obj !== 'object') return 'Mapping root must be an object';
  for (const [k, v] of Object.entries(obj)) {
    if (!v || typeof v !== 'object') return `Mapping for "${k}" must be an object`;
    if (v.number !== undefined && typeof v.number !== 'string') return `Mapping[${k}].number must be a string`;
    if (v.tvg_id !== undefined && typeof v.tvg_id !== 'string') return `Mapping[${k}].tvg_id must be a string`;
  }
  return null;
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
  const err = validateM3U(incoming);
  if (err) return res.status(400).json({ error: err });
  try {
    // Normalize types to lowercase and default to 'm3u' when absent
    const normalized = {
      urls: incoming.urls.map(u => ({
        ...u,
        type: u.type ? String(u.type).toLowerCase() : 'm3u'
      }))
    };
    const yamlText = yaml.stringify(normalized);
    fs.writeFileSync(M3U_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write m3u.yaml', detail: e.message });
  }
});

router.put('/api/config/epg', (req, res) => {
  const incoming = req.body;
  const err = validateEPG(incoming);
  if (err) return res.status(400).json({ error: err });
  try {
    const yamlText = yaml.stringify(incoming);
    fs.writeFileSync(EPG_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write epg.yaml', detail: e.message });
  }
});

router.put('/api/config/app', (req, res) => {
  const incoming = req.body;
  const err = validateAPP(incoming);
  if (err) return res.status(400).json({ error: err });
  try {
    const yamlText = yaml.stringify(incoming || {});
    fs.writeFileSync(APP_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write app.yaml', detail: e.message });
  }
});

router.put('/api/config/channel-map', (req, res) => {
  const incoming = req.body || {};
  const err = validateChannelMap(incoming);
  if (err) return res.status(400).json({ error: err });
  try {
    const yamlText = yaml.stringify(incoming || {});
    fs.writeFileSync(CHANNEL_MAP_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write channel-map.yaml', detail: e.message });
  }
});

router.post('/api/reload/channels', async (req, res) => {
  try {
    const count = await parseAll();
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
    const channels = JSON.parse(await fsPromises.readFile('./data/channels.json', 'utf8'));
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
    const channels = JSON.parse(await fsPromises.readFile('./data/channels.json', 'utf8'));
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
