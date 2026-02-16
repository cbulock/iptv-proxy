import express from 'express';
import fs from 'fs/promises';
import { getDataPath } from '../libs/paths.js';
import { requireAuth } from './auth.js';

const router = express.Router();
const ACTIVE = new Map(); // key: session id -> { ip, channelId, name, tvg_id, startedAt, lastSeen }
// Short grace period to smooth HLS segment request gaps.
const ACTIVE_IDLE_TTL_MS = 45 * 1000;
let channelsCache = [];

async function loadChannels() {
  try { channelsCache = JSON.parse(await fs.readFile(getDataPath('channels.json'), 'utf8')) || []; } catch { channelsCache = []; }
}

function findChannelMeta(channelId) {
  if (!Array.isArray(channelsCache) || channelsCache.length === 0) return {};
  const byId = channelsCache.find(c => String(c?.guideNumber || c?.tvg_id) === String(channelId));
  return byId ? { name: byId.name || byId.display_name || '', tvg_id: byId.tvg_id || '' } : {};
}

function normalizeIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return '';
  const first = raw.split(',')[0].trim();
  if (first.startsWith('::ffff:')) return first.slice(7);
  return first;
}

export async function registerUsage({ ip, channelId }) {
  if (!channelsCache.length) await loadChannels();
  const meta = findChannelMeta(channelId);
  const now = new Date().toISOString();
  const normalizedIp = normalizeIp(ip);
  const key = `${normalizedIp}|${channelId}`;
  const existing = ACTIVE.get(key);
  if (existing) {
    existing.lastSeen = now;
    if (!existing.name && meta.name) existing.name = meta.name;
    if (!existing.tvg_id && meta.tvg_id) existing.tvg_id = meta.tvg_id;
    return key;
  }
  ACTIVE.set(key, { ip: normalizedIp, channelId, ...meta, startedAt: now, lastSeen: now });
  return key;
}

export function touchUsage(key) {
  const entry = ACTIVE.get(key);
  if (entry) entry.lastSeen = new Date().toISOString();
}

export function unregisterUsage(key) {
  ACTIVE.delete(key);
}

router.get('/api/usage/active', requireAuth, (req, res) => {
  // prune entries idle beyond grace window
  const cutoff = Date.now() - ACTIVE_IDLE_TTL_MS;
  for (const [k, v] of ACTIVE.entries()) {
    if (new Date(v.lastSeen).getTime() < cutoff) ACTIVE.delete(k);
  }
  const list = Array.from(ACTIVE.values()).map(entry => ({
    ...entry,
    // keep both field names for backward compatibility
    lastSeenAt: entry.lastSeen
  }));
  res.json({ active: list, count: list.length });
});

export default router;
