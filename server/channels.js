import fs from 'fs/promises';
import express from 'express';
import RateLimit from 'express-rate-limit';
import { getChannels } from '../libs/channels-cache.js';

const router = express.Router();

const STATUS_FILE = './data/lineup_status.json';

const limiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

router.get('/', limiter, async (req, res) => {
  try {
    const channels = getChannels();
    let filtered = channels;

    if (req.query.status === 'online') {
      let statusMap = {};
      try {
        statusMap = JSON.parse(await fs.readFile(STATUS_FILE, 'utf8'));
      } catch (err) {
        return res.status(500).json({ error: 'Status data unavailable' });
      }

      filtered = channels.filter(c => statusMap[c.tvg_id] === 'online');
    }

    res.json(filtered);
  } catch (err) {
    console.error('Error loading channels:', err);
    res.status(500).json({ error: 'Failed to load channels' });
  }
});

export default router;
