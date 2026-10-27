import fs from 'fs';
import yaml from 'yaml';
import { loadConfig } from './config-loader.js';
import { get, getDatabase, initDatabase, transaction } from './database.js';
import { getConfigPath } from './paths.js';

let seededConfigPath = null;

function ensureDatabaseReady() {
  return initDatabase();
}

function getChannelMapConfigPath() {
  return getConfigPath('channel-map.yaml');
}

function getLatestMappingTimestamp() {
  const row = get('SELECT MAX(updated_at) AS updated_at FROM channel_mappings');
  return row?.updated_at ? Date.parse(row.updated_at) : 0;
}

function shouldReseedFromConfig(configPath) {
  try {
    const stat = fs.statSync(configPath);
    return stat.mtimeMs > getLatestMappingTimestamp();
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

function normalizeMappingEntry(row) {
  return {
    ...(row.name ? { name: row.name } : {}),
    ...(row.guide_number ? { number: row.guide_number } : {}),
    ...(row.tvg_id ? { tvg_id: row.tvg_id } : {}),
    ...(row.logo ? { logo: row.logo } : {}),
    ...(row.stream_url ? { url: row.stream_url } : {}),
    ...(row.group_name ? { group: row.group_name } : {}),
  };
}

function toRows(channelMap, timestamp) {
  return Object.entries(channelMap || {}).map(([key, value]) => ({
    key,
    name: value?.name || null,
    guide_number: value?.number || null,
    tvg_id: value?.tvg_id || null,
    logo: value?.logo || null,
    stream_url: value?.url || null,
    group_name: value?.group || null,
    created_at: timestamp,
    updated_at: timestamp,
  }));
}

function writeChannelMapFile(channelMap) {
  fs.writeFileSync(getChannelMapConfigPath(), yaml.stringify(channelMap || {}), 'utf8');
}

function replaceChannelMapInternal(channelMap, { writeConfig = true } = {}) {
  ensureDatabaseReady();

  const timestamp = new Date().toISOString();
  const rows = toRows(channelMap, timestamp);
  const db = getDatabase();

  const applyChanges = transaction(mappingRows => {
    db.prepare('DELETE FROM channel_mappings').run();

    const insertMapping = db.prepare(`
      INSERT INTO channel_mappings (
        key, name, guide_number, tvg_id, logo, stream_url, group_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of mappingRows) {
      insertMapping.run(
        row.key,
        row.name,
        row.guide_number,
        row.tvg_id,
        row.logo,
        row.stream_url,
        row.group_name,
        row.created_at,
        row.updated_at
      );
    }
  });

  applyChanges(rows);

  seededConfigPath = getChannelMapConfigPath();

  if (writeConfig) {
    writeChannelMapFile(channelMap || {});
  }
}

export function ensureChannelMapSeeded() {
  ensureDatabaseReady();

  const configPath = getChannelMapConfigPath();
  const row = get('SELECT COUNT(*) AS count FROM channel_mappings');

  if (seededConfigPath === null) {
    seededConfigPath = configPath;
    if (row.count > 0) {
      return false;
    }
  } else if (seededConfigPath !== configPath) {
    replaceChannelMapInternal(loadConfig('channelMap') || {}, { writeConfig: false });
    return true;
  }

  if (shouldReseedFromConfig(configPath)) {
    replaceChannelMapInternal(loadConfig('channelMap') || {}, { writeConfig: false });
    return true;
  }

  if (row.count > 0) {
    return false;
  }

  const channelMap = loadConfig('channelMap') || {};
  if (Object.keys(channelMap).length === 0) {
    return false;
  }

  replaceChannelMapInternal(channelMap, { writeConfig: false });
  return true;
}

export function loadChannelMapFromStore() {
  ensureChannelMapSeeded();

  const rows = getDatabase()
    .prepare(
      `SELECT key, name, guide_number, tvg_id, logo, stream_url, group_name
         FROM channel_mappings
        ORDER BY rowid ASC`
    )
    .all();

  return rows.reduce((map, row) => {
    map[row.key] = normalizeMappingEntry(row);
    return map;
  }, {});
}

export function replaceChannelMap(channelMap) {
  replaceChannelMapInternal(channelMap || {});
}

export default {
  ensureChannelMapSeeded,
  loadChannelMapFromStore,
  replaceChannelMap,
};
