import express from 'express';
import fs from 'fs/promises';
import { getDataPath } from '../libs/paths.js';
import { requireAuth } from './auth.js';

const router = express.Router();
const ACTIVE = new Map(); // key: session id -> { ip, channelId, name, tvg_id, userAgent, client, startedAt, lastSeen }
// Short grace period to smooth HLS segment request gaps.
const ACTIVE_IDLE_TTL_MS = 45 * 1000;
// Ring buffer for recently-completed stream sessions.
const HISTORY = [];
const HISTORY_MAX = 100;
let channelsCache = [];

async function loadChannels() {
  try { channelsCache = JSON.parse(await fs.readFile(getDataPath('channels.json'), 'utf8')) || []; } catch { channelsCache = []; }
}

function findChannelMeta(channelId) {
  if (!Array.isArray(channelsCache) || channelsCache.length === 0) return {};
  const byId = channelsCache.find(c => String(c?.guideNumber || c?.tvg_id) === String(channelId));
  return byId ? { name: byId.name || byId.display_name || '', tvg_id: byId.tvg_id || '' } : {};
}

export function parseClientName(userAgent) {
  if (!userAgent) return '';
  const ua = String(userAgent);
  // Common IPTV clients
  if (/plex/i.test(ua)) return 'Plex';
  if (/jellyfin/i.test(ua)) return 'Jellyfin';
  if (/emby/i.test(ua)) return 'Emby';
  if (/infuse/i.test(ua)) return 'Infuse';
  if (/vlc/i.test(ua)) return 'VLC';
  if (/kodi/i.test(ua)) return 'Kodi';
  if (/tivimate/i.test(ua)) return 'TiViMate';
  if (/iptv\s*pro/i.test(ua)) return 'IPTV Pro';
  if (/iptv\s*smarters/i.test(ua)) return 'IPTV Smarters';
  if (/gse\s*iptv/i.test(ua)) return 'GSE IPTV';
  if (/perfect\s*player/i.test(ua)) return 'Perfect Player';
  if (/televizo/i.test(ua)) return 'Televizo';
  if (/sparkle/i.test(ua)) return 'Sparkle';
  if (/ott\s*navigator|ottnavigator/i.test(ua)) return 'OTT Navigator';
  // Fall back to first token of UA string
  const match = ua.match(/^([^\s/]+)/);
  return match ? match[1] : '';
}

function normalizeIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return '';
  const first = raw.split(',')[0].trim();
  if (first.startsWith('::ffff:')) return first.slice(7);
  return first;
}

export async function registerUsage({ ip, channelId, userAgent = '' }) {
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
    if (!existing.userAgent && userAgent) {
      existing.userAgent = userAgent;
      existing.client = parseClientName(userAgent);
    }
    return key;
  }
  const client = parseClientName(userAgent);
  ACTIVE.set(key, { ip: normalizedIp, channelId, ...meta, userAgent, client, startedAt: now, lastSeen: now });
  return key;
}

export function touchUsage(key) {
  const entry = ACTIVE.get(key);
  if (entry) entry.lastSeen = new Date().toISOString();
}

export function unregisterUsage(key) {
  const entry = ACTIVE.get(key);
  if (entry) {
    const endedAt = new Date().toISOString();
    const durationSeconds = Math.round(
      (new Date(endedAt).getTime() - new Date(entry.startedAt).getTime()) / 1000
    );
    HISTORY.push({ ...entry, endedAt, durationSeconds });
    if (HISTORY.length > HISTORY_MAX) HISTORY.shift();
  }
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

router.get('/api/usage/history', requireAuth, (req, res) => {
  // Return a copy in reverse-chronological order (most recent first)
  const list = [...HISTORY].reverse();
  res.json({ history: list, count: list.length });
});

export default router;
