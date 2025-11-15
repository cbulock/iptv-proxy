import express from 'express';
import fs from 'fs/promises';
import { runHealthCheck } from '../scripts/check-channel-health.js';

const router = express.Router();
const STATUS_FILE = './data/lineup_status.json';

router.get('/api/channel-health', async (req, res) => {
  try {
    let raw = {};
    try { raw = JSON.parse(await fs.readFile(STATUS_FILE, 'utf8')); } catch {}
    const summary = raw.summary || raw; // backward compat
    const details = raw.details || [];
    res.json({ status: 'ok', summary, details });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read health status', detail: e.message });
  }
});

router.post('/api/channel-health/run', async (req, res) => {
  try {
    const statusMap = await runHealthCheck();
    // After run we can re-read the file to pull details
    let raw = {};
    try { raw = JSON.parse(await fs.readFile(STATUS_FILE, 'utf8')); } catch {}
    const summary = raw.summary || statusMap;
    const details = raw.details || [];
    res.json({ status: 'completed', summary, details });
  } catch (e) {
    res.status(500).json({ error: 'Health check failed', detail: e.message });
  }
});

export default router;
