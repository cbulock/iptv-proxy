import fs from 'fs';
import yaml from 'yaml';
import { loadConfig } from './config-loader.js';
import { get, getDatabase, initDatabase } from './database.js';
import { getConfigPath } from './paths.js';

const APP_CONFIG_KEY = 'app-config';

let seededConfigPath = null;

function ensureDatabaseReady() {
  return initDatabase();
}

function getAppConfigPath() {
  return getConfigPath('app.yaml');
}

function getLatestAppConfigTimestamp() {
  const row = get('SELECT updated_at FROM app_settings WHERE key = ?', [APP_CONFIG_KEY]);
  return row?.updated_at ? Date.parse(row.updated_at) : 0;
}

function shouldReseedFromConfig(configPath) {
  try {
    const stat = fs.statSync(configPath);
    return stat.mtimeMs > getLatestAppConfigTimestamp();
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

function writeAppConfigFile(appConfig) {
  fs.writeFileSync(getAppConfigPath(), yaml.stringify(appConfig || {}), 'utf8');
}

function replaceAppConfigInternal(appConfig, { writeConfig = true } = {}) {
  ensureDatabaseReady();

  const value = appConfig || {};
  const timestamp = new Date().toISOString();

  getDatabase()
    .prepare(
      `
        INSERT INTO app_settings (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `
    )
    .run(APP_CONFIG_KEY, JSON.stringify(value), timestamp);

  seededConfigPath = getAppConfigPath();

  if (writeConfig) {
    writeAppConfigFile(value);
  }
}

export function ensureAppConfigSeeded() {
  ensureDatabaseReady();

  const configPath = getAppConfigPath();
  const row = get('SELECT COUNT(*) AS count FROM app_settings WHERE key = ?', [APP_CONFIG_KEY]);

  if (seededConfigPath === null) {
    seededConfigPath = configPath;
    if (row.count > 0) {
      return false;
    }
  } else if (seededConfigPath !== configPath) {
    replaceAppConfigInternal(loadConfig('app') || {}, { writeConfig: false });
    return true;
  }

  if (shouldReseedFromConfig(configPath)) {
    replaceAppConfigInternal(loadConfig('app') || {}, { writeConfig: false });
    return true;
  }

  if (row.count > 0) {
    return false;
  }

  const appConfig = loadConfig('app') || {};
  if (Object.keys(appConfig).length === 0) {
    return false;
  }

  replaceAppConfigInternal(appConfig, { writeConfig: false });
  return true;
}

export function loadAppConfigFromStore() {
  ensureAppConfigSeeded();

  const row = get('SELECT value_json FROM app_settings WHERE key = ?', [APP_CONFIG_KEY]);
  if (!row?.value_json) {
    return {};
  }

  try {
    return JSON.parse(row.value_json);
  } catch {
    return {};
  }
}

export function replaceAppConfig(appConfig) {
  replaceAppConfigInternal(appConfig || {});
}

export default {
  ensureAppConfigSeeded,
  loadAppConfigFromStore,
  replaceAppConfig,
};
