import fs from 'fs';
import express from 'express';
import yaml from 'yaml';
import { parseAll } from '../scripts/parseM3U.js';

const router = express.Router();

const M3U_PATH = './config/m3u.yaml';

function loadM3U() {
  const text = fs.readFileSync(M3U_PATH, 'utf8');
  return yaml.parse(text) || {};
}

function validateM3U(obj) {
  if (!obj || typeof obj !== 'object') return 'Config root must be an object';
  if (!Array.isArray(obj.urls)) return 'Config must have an array property "urls"';
  for (const [i, u] of obj.urls.entries()) {
    if (!u.name) return `urls[${i}].name missing`;
    if (!u.url) return `urls[${i}].url missing`;
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

router.put('/api/config/m3u', (req, res) => {
  const incoming = req.body;
  const err = validateM3U(incoming);
  if (err) return res.status(400).json({ error: err });
  try {
    const yamlText = yaml.stringify(incoming);
    fs.writeFileSync(M3U_PATH, yamlText, 'utf8');
    res.json({ status: 'saved' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write m3u.yaml', detail: e.message });
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

export default router;
