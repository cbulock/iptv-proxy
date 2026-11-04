import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { getDatabase, initDatabase } from '../libs/database.js';
import { requireAuth } from './auth.js';

const router = express.Router();
const ACTIVE = new Map(); // key: viewer identity or IP plus channel
const ACTIVE_REFERENCES = new Map(); // number of overlapping stream requests per key
// Short grace period to smooth HLS segment request gaps.
const ACTIVE_IDLE_TTL_MS = 45 * 1000;
const HISTORY_MAX = 1000;
let channelsCache = [];

async function loadChannels() {
  const row = usageDatabase().prepare('SELECT channels_json FROM channel_snapshots WHERE id = 1').get();
  channelsCache = row?.channels_json ? JSON.parse(row.channels_json) : [];
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

function decodeIdentityHeader(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength * 4) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    const hasControlCharacter = Array.from(decoded).some(character => {
      const code = character.codePointAt(0);
      return code <= 31 || code === 127;
    });
    return decoded.length <= maxLength && !hasControlCharacter ? decoded : null;
  } catch {
    return null;
  }
}

export function readUsageIdentity(req, secret = process.env.IPTV_USAGE_IDENTITY_SECRET) {
  if (typeof secret !== 'string' || !secret) return null;
  const supplied = req.headers['x-iptv-identity-secret'];
  if (typeof supplied !== 'string') return null;
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const userId = decodeIdentityHeader(req.headers['x-iptv-user-id'], 256);
  const userNameHeader = req.headers['x-iptv-user-name'];
  const userName = userNameHeader === undefined ? '' : decodeIdentityHeader(userNameHeader, 256);
  return userId && userName !== null ? { userId, userName } : null;
}

export async function registerUsage({
  ip,
  channelId,
  userAgent = '',
  userId = '',
  userName = '',
  transient = false,
}) {
  if (!channelsCache.length) await loadChannels();
  pruneIdleUsage();
  const meta = findChannelMeta(channelId);
  const now = new Date().toISOString();
  const normalizedIp = normalizeIp(ip);
  const key = JSON.stringify(
    userId ? ['user', userId, normalizedIp, channelId] : ['ip', normalizedIp, channelId]
  );
  const existing = ACTIVE.get(key);
  if (existing) {
    if (!transient) ACTIVE_REFERENCES.set(key, (ACTIVE_REFERENCES.get(key) || 0) + 1);
    existing.lastSeen = now;
    if (!existing.name && meta.name) existing.name = meta.name;
    if (!existing.tvg_id && meta.tvg_id) existing.tvg_id = meta.tvg_id;
    if (userName) existing.userName = userName;
    if (!existing.userAgent && userAgent) {
      existing.userAgent = userAgent;
      existing.client = parseClientName(userAgent);
    }
    return key;
  }
  const client = parseClientName(userAgent);
  ACTIVE.set(key, {
    ip: normalizedIp,
    channelId,
    userId,
    userName,
    ...meta,
    userAgent,
    client,
    startedAt: now,
    lastSeen: now,
  });
  ACTIVE_REFERENCES.set(key, transient ? 0 : 1);
  return key;
}

export function touchUsage(key) {
  const entry = ACTIVE.get(key);
  if (entry) entry.lastSeen = new Date().toISOString();
}

export function unregisterUsage(key) {
  const entry = ACTIVE.get(key);
  if (entry) {
    const references = ACTIVE_REFERENCES.get(key) ?? 1;
    if (references > 1) {
      ACTIVE_REFERENCES.set(key, references - 1);
      return;
    }
    completeUsage(entry);
  }
  ACTIVE.delete(key);
  ACTIVE_REFERENCES.delete(key);
}

function completeUsage(entry, endedAt = new Date().toISOString()) {
  const durationSeconds = Math.max(
    0,
    Math.round((Date.parse(endedAt) - Date.parse(entry.startedAt)) / 1000)
  );
  const db = usageDatabase();
  db.prepare(
    `INSERT INTO playback_history
    (ip, channel_id, user_id, user_name, name, tvg_id, user_agent, client, started_at, ended_at, duration_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.ip,
    String(entry.channelId),
    entry.userId,
    entry.userName,
    entry.name || '',
    entry.tvg_id || '',
    entry.userAgent,
    entry.client,
    entry.startedAt,
    endedAt,
    durationSeconds
  );
  db.prepare(
    'DELETE FROM playback_history WHERE id NOT IN (SELECT id FROM playback_history ORDER BY id DESC LIMIT ?)'
  ).run(HISTORY_MAX);
}

function usageDatabase() {
  try {
    return getDatabase();
  } catch {
    return initDatabase();
  }
}

function pruneIdleUsage() {
  const cutoff = Date.now() - ACTIVE_IDLE_TTL_MS;
  for (const [key, entry] of ACTIVE.entries()) {
    if (Date.parse(entry.lastSeen) < cutoff) {
      completeUsage(entry, entry.lastSeen);
      ACTIVE.delete(key);
      ACTIVE_REFERENCES.delete(key);
    }
  }
}

router.get('/api/usage/active', requireAuth, (req, res) => {
  pruneIdleUsage();
  const list = Array.from(ACTIVE.values()).map(entry => ({
    ...entry,
    // keep both field names for backward compatibility
    lastSeenAt: entry.lastSeen,
  }));
  res.json({ active: list, count: list.length });
});

router.get('/api/usage/history', requireAuth, (req, res) => {
  pruneIdleUsage();
  const list = usageDatabase()
    .prepare(
      `SELECT id, ip, channel_id AS channelId, user_id AS userId,
    user_name AS userName, name, tvg_id, user_agent AS userAgent, client,
    started_at AS startedAt, ended_at AS endedAt, duration_seconds AS durationSeconds
    FROM playback_history ORDER BY id DESC LIMIT ?`
    )
    .all(HISTORY_MAX);
  res.json({ history: list, count: list.length });
});

export default router;
