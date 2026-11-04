import { getDatabase } from './database.js';

/** Resolve a stable source-channel route target without relying on mutable names. */
export function getSourceChannelById(id) {
  const row = getDatabase()
    .prepare(
      `SELECT sc.name, sc.tvg_id, sc.stream_url, sc.raw_json, s.name AS source_name
         FROM source_channels sc JOIN sources s ON s.id = sc.source_id WHERE sc.id = ?`
    )
    .get(id);
  if (!row) return null;
  let raw = {};
  try {
    raw = row.raw_json ? JSON.parse(row.raw_json) : {};
  } catch (_err) {
    raw = {};
  }
  return {
    ...raw,
    name: row.name,
    source: row.source_name,
    tvg_id: row.tvg_id || raw.tvg_id || '',
    original_url: row.stream_url || raw.original_url || '',
  };
}
