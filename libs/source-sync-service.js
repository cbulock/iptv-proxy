import crypto from 'crypto';
import { getDatabase, initDatabase, transaction } from './database.js';

function ensureDatabaseReady() {
  return initDatabase();
}

function getChannelIdentity(channel) {
  return [
    channel.external_key || '',
    channel.tvg_id || '',
    channel.name || '',
    channel.original_url || channel.stream_url || '',
  ].join('|');
}

export function startSourceSyncRun(sourceId, kind) {
  ensureDatabaseReady();

  const runId = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO source_sync_runs (id, source_id, kind, status, started_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(runId, sourceId, kind, 'running', new Date().toISOString());

  return runId;
}

export function finishSourceSyncRun(runId, result = {}) {
  ensureDatabaseReady();

  const status = result.status || 'success';
  getDatabase()
    .prepare(
      `UPDATE source_sync_runs
          SET status = ?,
              finished_at = ?,
              error = ?
        WHERE id = ?`
    )
    .run(status, new Date().toISOString(), result.error || null, runId);
}

export function replaceDiscoveredSourceChannels(sourceId, channels) {
  ensureDatabaseReady();

  const saveChannels = transaction(nextChannels => {
    const db = getDatabase();
    const existingRows = db
      .prepare(
        `SELECT id, external_key, name, tvg_id, stream_url
           FROM source_channels
          WHERE source_id = ?`
      )
      .all(sourceId);
    const existingByExternalKey = new Map();
    const existingByIdentity = new Map();

    for (const row of existingRows) {
      if (row.external_key) {
        existingByExternalKey.set(row.external_key, row);
      }
      existingByIdentity.set(
        getChannelIdentity({
          external_key: row.external_key,
          tvg_id: row.tvg_id,
          name: row.name,
          original_url: row.stream_url,
        }),
        row
      );
    }

    const insertChannel = db.prepare(`
      INSERT INTO source_channels (
        id,
        source_id,
        external_key,
        name,
        tvg_id,
        logo,
        group_name,
        guide_number,
        stream_url,
        raw_json,
        last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateChannel = db.prepare(`
      UPDATE source_channels
         SET external_key = ?,
             name = ?,
             tvg_id = ?,
             logo = ?,
             group_name = ?,
             guide_number = ?,
             stream_url = ?,
             raw_json = ?,
             last_seen_at = ?
       WHERE id = ?
    `);
    const deleteChannel = db.prepare('DELETE FROM source_channels WHERE id = ?');

    const seenAt = new Date().toISOString();
    const retainedIds = new Set();
    for (const channel of nextChannels) {
      const existing =
        (channel.external_key ? existingByExternalKey.get(channel.external_key) : null) ||
        existingByIdentity.get(getChannelIdentity(channel));

      if (existing?.external_key) {
        existingByExternalKey.delete(existing.external_key);
      }
      existingByIdentity.delete(
        getChannelIdentity({
          external_key: existing?.external_key,
          tvg_id: existing?.tvg_id,
          name: existing?.name,
          original_url: existing?.stream_url,
        })
      );

      const channelId = existing?.id || crypto.randomUUID();
      retainedIds.add(channelId);

      if (existing) {
        updateChannel.run(
          channel.external_key || null,
          channel.name,
          channel.tvg_id || null,
          channel.logo || null,
          channel.group || null,
          channel.guideNumber || null,
          channel.original_url || channel.stream_url || null,
          JSON.stringify(channel),
          seenAt,
          channelId
        );
      } else {
        insertChannel.run(
          channelId,
          sourceId,
          channel.external_key || null,
          channel.name,
          channel.tvg_id || null,
          channel.logo || null,
          channel.group || null,
          channel.guideNumber || null,
          channel.original_url || channel.stream_url || null,
          JSON.stringify(channel),
          seenAt
        );
      }
    }

    for (const row of existingRows) {
      if (!retainedIds.has(row.id)) {
        deleteChannel.run(row.id);
      }
    }
  });

  saveChannels(channels);
}

export default {
  finishSourceSyncRun,
  replaceDiscoveredSourceChannels,
  startSourceSyncRun,
};
