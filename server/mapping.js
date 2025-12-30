import express from 'express';
import fs from 'fs/promises';
import { loadConfig } from '../libs/config-loader.js';

const router = express.Router();
const CHANNELS_FILE = './data/channels.json';
const CHANNEL_MAP_FILE = './config/channel-map.yaml';

router.get('/api/mapping/conflicts', async (req, res) => {
  try {
    let channels = [];
    try { channels = JSON.parse(await fs.readFile(CHANNELS_FILE, 'utf8')); } catch {}

    const byName = new Map();
    for (const ch of Array.isArray(channels) ? channels : []) {
      const name = String(ch?.name || ch?.display_name || '').trim();
      const tvg = String(ch?.tvg_id || '').trim();
      if (!name || !tvg) continue;
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(tvg);
    }

    let mapping = {};
    try { mapping = loadConfig('channelMap'); } catch {}

    const conflicts = [];
    for (const [name, set] of byName.entries()) {
      const candidates = Array.from(set);
      if (candidates.length > 1) {
        conflicts.push({ name, tvgCandidates: candidates, count: candidates.length, mapped: mapping?.[name]?.tvg_id || '' });
      }
    }

    // sort conflicts by name for stable output
    conflicts.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ conflicts });
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute mapping conflicts', detail: e.message });
  }
});

export default router;