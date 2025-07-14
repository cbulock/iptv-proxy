import fs from 'fs/promises';
import express from 'express';
const router = express.Router();

const CHANNELS_FILE = './data/channels.json';
const STATUS_FILE = './data/lineup_status.json';

router.get('/', async (req, res) => {
  try {
    const channels = JSON.parse(await fs.readFile(CHANNELS_FILE, 'utf8'));
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
