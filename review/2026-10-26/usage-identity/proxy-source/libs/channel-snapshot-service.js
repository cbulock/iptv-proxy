import { get, initDatabase, run } from './database.js';

function ensureDatabaseReady() {
  return initDatabase();
}

export function loadChannelSnapshot() {
  ensureDatabaseReady();

  const row = get('SELECT channels_json FROM channel_snapshots WHERE id = 1');
  if (!row?.channels_json) {
    return [];
  }

  return JSON.parse(row.channels_json);
}

export function replaceChannelSnapshot(channels = []) {
  ensureDatabaseReady();

  const nextChannels = Array.isArray(channels) ? channels : [];
  const updatedAt = new Date().toISOString();
  run(
    `INSERT INTO channel_snapshots (id, channels_json, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       channels_json = excluded.channels_json,
       updated_at = excluded.updated_at`,
    [JSON.stringify(nextChannels), updatedAt]
  );

  return {
    count: nextChannels.length,
    updatedAt,
  };
}

export function getChannelSnapshotMetadata() {
  ensureDatabaseReady();

  const row = get(
    `SELECT updated_at, LENGTH(channels_json) AS size_bytes
       FROM channel_snapshots
      WHERE id = 1`
  );

  if (!row) {
    return null;
  }

  return {
    updatedAt: row.updated_at,
    sizeBytes: row.size_bytes || 0,
  };
}

export default {
  getChannelSnapshotMetadata,
  loadChannelSnapshot,
  replaceChannelSnapshot,
};
