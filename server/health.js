import express from 'express';
import fs from 'fs/promises';
import RateLimit from 'express-rate-limit';
import { runHealthCheck } from '../scripts/check-channel-health.js';
import { getDataPath } from '../libs/paths.js';
import { getChannels } from '../libs/channels-cache.js';
import { asyncHandler } from './error-handler.js';
import rateLimit from 'express-rate-limit';
import { requireAuth } from './auth.js';

const router = express.Router();
const STATUS_FILE = getDataPath('lineup_status.json');
const LAST_LOG_FILE = getDataPath('lineup_health_last.json');
const CHANNELS_FILE = getDataPath('channels.json');

// Rate limiter for health check endpoints
const healthLimiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per minute
  skip: (req) => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: (req) => req.ip || 'unknown',
});

const channelHealthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 60, // limit each IP to 60 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: (req) => req.ip || 'unknown',
});

// Basic health check endpoint for Docker and monitoring
// This is a liveness check - server is running
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Liveness probe - checks if the server process is running
router.get('/health/live', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'Server is alive',
    timestamp: new Date().toISOString() 
  });
});

// Readiness probe - checks if the server is ready to handle requests
router.get('/health/ready', healthLimiter, asyncHandler(async (req, res) => {
  const checks = {
    timestamp: new Date().toISOString(),
    ready: true,
    checks: {}
  };

  // Check if channels are loaded
  try {
    const channels = getChannels();
    const hasChannels = channels.length > 0;
    
    checks.checks.channels = {
      status: hasChannels ? 'ok' : 'warning',
      count: channels.length,
      available: hasChannels
    };
    
    if (!hasChannels) {
      checks.ready = false;
      checks.checks.channels.message = 'No channels loaded';
    }
  } catch (err) {
    checks.ready = false;
    checks.checks.channels = {
      status: 'error',
      message: err.message
    };
  }

  // Check if channels file exists and is readable
  try {
    const stats = await fs.stat(CHANNELS_FILE);
    checks.checks.channelsFile = {
      status: 'ok',
      size: stats.size,
      modified: stats.mtime.toISOString()
    };
  } catch (err) {
    checks.ready = false;
    checks.checks.channelsFile = {
      status: 'error',
      message: 'Channels file not found or not readable'
    };
  }

  const statusCode = checks.ready ? 200 : 503;
  res.status(statusCode).json(checks);
}));

router.get('/api/channel-health', requireAuth, channelHealthLimiter, async (req, res) => {
  try {
    let raw = {};
    try { raw = JSON.parse(await fs.readFile(STATUS_FILE, 'utf8')); } catch {}
    const summary = raw.summary || raw; // backward compat
    const details = raw.details || [];
    let meta = null;
    try { const last = JSON.parse(await fs.readFile(LAST_LOG_FILE, 'utf8')); meta = last.meta || null; } catch {}
    res.json({ status: 'ok', summary, details, meta });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read health status', detail: e.message });
  }
});

router.post('/api/channel-health/run', requireAuth, channelHealthLimiter, async (req, res) => {
  try {
    const statusMap = await runHealthCheck();
    // After run we can re-read the file to pull details
    let raw = {};
    try { raw = JSON.parse(await fs.readFile(STATUS_FILE, 'utf8')); } catch {}
    const summary = raw.summary || statusMap;
    const details = raw.details || [];
    let meta = null;
    try { const last = JSON.parse(await fs.readFile(LAST_LOG_FILE, 'utf8')); meta = last.meta || null; } catch {}
    res.json({ status: 'completed', summary, details, meta });
  } catch (e) {
    res.status(500).json({ error: 'Health check failed', detail: e.message });
  }
});

export default router;
