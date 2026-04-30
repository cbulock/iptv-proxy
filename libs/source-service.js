import crypto from 'crypto';
import fs from 'fs';
import yaml from 'yaml';
import { loadConfig } from './config-loader.js';
import { all, get, getDatabase, initDatabase, transaction } from './database.js';
import { getConfigPath } from './paths.js';

let seededConfigPath = null;

function ensureDatabaseReady() {
  return initDatabase();
}

function getProvidersConfigPath() {
  return getConfigPath('providers.yaml');
}

function normalizeSourceRow(row) {
  const type = row.type || 'm3u';
  const url =
    type === 'hdhomerun'
      ? row.base_url || row.playlist_url || ''
      : row.playlist_url || row.base_url || '';

  return {
    id: row.id,
    name: row.name,
    url,
    type,
    epg: row.epg_url || '',
    enabled: row.enabled !== 0,
  };
}

function serializeSource(provider, timestamp) {
  const type = provider.type || 'm3u';
  const sourceUrl = provider.url || '';

  return {
    id: provider.id || crypto.randomUUID(),
    name: provider.name,
    type,
    base_url: type === 'hdhomerun' ? sourceUrl : null,
    playlist_url: type === 'hdhomerun' ? null : sourceUrl,
    epg_url: provider.epg || null,
    auth_mode: null,
    headers_json: null,
    enabled: provider.enabled === false ? 0 : 1,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function toProvidersConfig(sources) {
  return {
    providers: sources.map(source => ({
      name: source.name,
      url: source.url,
      type: source.type || 'm3u',
      ...(source.epg ? { epg: source.epg } : {}),
    })),
  };
}

function writeProvidersConfigFile(providersConfig) {
  fs.writeFileSync(getConfigPath('providers.yaml'), yaml.stringify(providersConfig), 'utf8');
}

function replaceSourcesInternal(providersConfig, { writeConfig = true } = {}) {
  ensureDatabaseReady();

  const providers = Array.isArray(providersConfig?.providers) ? providersConfig.providers : [];
  const timestamp = new Date().toISOString();
  const rows = providers.map(provider => serializeSource(provider, timestamp));

  const applyChanges = transaction(sourceRows => {
    getDatabase().prepare('DELETE FROM sources').run();

    const insertSource = getDatabase().prepare(`
      INSERT INTO sources (
        id,
        name,
        type,
        base_url,
        playlist_url,
        epg_url,
        auth_mode,
        headers_json,
        enabled,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of sourceRows) {
      insertSource.run(
        row.id,
        row.name,
        row.type,
        row.base_url,
        row.playlist_url,
        row.epg_url,
        row.auth_mode,
        row.headers_json,
        row.enabled,
        row.created_at,
        row.updated_at
      );
    }
  });

  applyChanges(rows);

  if (writeConfig) {
    writeProvidersConfigFile(toProvidersConfig(rows.map(normalizeSourceRow)));
  }

  seededConfigPath = getProvidersConfigPath();
}

export function ensureSourcesSeeded() {
  ensureDatabaseReady();
  const providersConfigPath = getProvidersConfigPath();
  const row = get('SELECT COUNT(*) AS count FROM sources');

  if (seededConfigPath === null) {
    seededConfigPath = providersConfigPath;
    if (row.count > 0) {
      return false;
    }
  } else if (seededConfigPath !== providersConfigPath) {
    replaceSourcesInternal(loadConfig('providers'), { writeConfig: false });
    return true;
  }

  if (row.count > 0) {
    return false;
  }

  const providersConfig = loadConfig('providers');
  const providers = Array.isArray(providersConfig?.providers) ? providersConfig.providers : [];
  if (providers.length === 0) {
    return false;
  }

  replaceSourcesInternal(providersConfig, { writeConfig: false });
  return true;
}

export function listSources() {
  ensureSourcesSeeded();

  return all(
    `SELECT id, name, type, base_url, playlist_url, epg_url, enabled
       FROM sources
      ORDER BY created_at ASC, name ASC`
  ).map(normalizeSourceRow);
}

export function loadProvidersConfigFromStore() {
  return toProvidersConfig(listSources());
}

export function loadM3UConfigFromStore() {
  return {
    urls: listSources().map(source => ({
      name: source.name,
      url: source.url,
      type: source.type || 'm3u',
    })),
  };
}

export function loadEPGConfigFromStore() {
  return {
    urls: listSources()
      .filter(source => source.epg)
      .map(source => ({
        name: source.name,
        url: source.epg,
      })),
  };
}

export function replaceProvidersConfig(providersConfig) {
  replaceSourcesInternal(providersConfig);
}

export function replaceM3UConfig(m3uConfig) {
  const existingSourcesByName = new Map(listSources().map(source => [source.name, source]));
  const urls = Array.isArray(m3uConfig?.urls) ? m3uConfig.urls : [];

  replaceProvidersConfig({
    providers: urls.map(source => ({
      name: source.name,
      url: source.url,
      type: source.type || 'm3u',
      epg: existingSourcesByName.get(source.name)?.epg || '',
      enabled: existingSourcesByName.get(source.name)?.enabled ?? true,
    })),
  });
}

export function replaceEPGConfig(epgConfig) {
  const sources = listSources();
  const sourceNames = new Set(sources.map(source => source.name));
  const urls = Array.isArray(epgConfig?.urls) ? epgConfig.urls : [];
  const unknownSources = urls
    .map(source => source.name)
    .filter(name => name && !sourceNames.has(name));

  if (unknownSources.length > 0) {
    throw new Error(
      `Unknown source${unknownSources.length === 1 ? '' : 's'} in EPG config: ${unknownSources.join(', ')}`
    );
  }

  const epgBySourceName = new Map(urls.map(source => [source.name, source.url]));

  replaceProvidersConfig({
    providers: sources.map(source => ({
      name: source.name,
      url: source.url,
      type: source.type || 'm3u',
      epg: epgBySourceName.get(source.name) || '',
      enabled: source.enabled,
    })),
  });
}

export default {
  ensureSourcesSeeded,
  listSources,
  loadEPGConfigFromStore,
  loadM3UConfigFromStore,
  loadProvidersConfigFromStore,
  replaceEPGConfig,
  replaceM3UConfig,
  replaceProvidersConfig,
};
