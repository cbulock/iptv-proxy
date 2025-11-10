import fs from 'fs';
import express from 'express';
import yaml from 'yaml';
import { parseAll } from '../scripts/parseM3U.js';
import { refreshEPG } from './epg.js';

const router = express.Router();

const M3U_PATH = './config/m3u.yaml';
const EPG_PATH = './config/epg.yaml';
const APP_PATH = './config/app.yaml';

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

export default router;
