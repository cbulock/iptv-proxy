import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getDataPath } from './paths.js';

const DEFAULT_DB_FILENAME = 'iptv-proxy.sqlite';

const MIGRATIONS = [
  {
    id: '001-initial-schema',
    sql: `
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        base_url TEXT,
        playlist_url TEXT,
        epg_url TEXT,
        auth_mode TEXT,
        headers_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS source_sync_runs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT,
        FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS source_channels (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        external_key TEXT,
        name TEXT NOT NULL,
        tvg_id TEXT,
        logo TEXT,
        group_name TEXT,
        guide_number TEXT,
        stream_url TEXT,
        raw_json TEXT,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS canonical_channels (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        tvg_id TEXT,
        guide_number TEXT,
        logo TEXT,
        group_name TEXT,
        published INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_bindings (
        id TEXT PRIMARY KEY,
        source_channel_id TEXT NOT NULL,
        canonical_channel_id TEXT NOT NULL,
        binding_type TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        is_preferred_stream INTEGER NOT NULL DEFAULT 0,
        confidence REAL,
        resolution_state TEXT NOT NULL,
        FOREIGN KEY (source_channel_id) REFERENCES source_channels(id) ON DELETE CASCADE,
        FOREIGN KEY (canonical_channel_id) REFERENCES canonical_channels(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS guide_bindings (
        id TEXT PRIMARY KEY,
        canonical_channel_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        epg_channel_id TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (canonical_channel_id) REFERENCES canonical_channels(id) ON DELETE CASCADE,
        FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS output_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        settings_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS output_profile_channels (
        id TEXT PRIMARY KEY,
        output_profile_id TEXT NOT NULL,
        canonical_channel_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        guide_number_override TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (output_profile_id) REFERENCES output_profiles(id) ON DELETE CASCADE,
        FOREIGN KEY (canonical_channel_id) REFERENCES canonical_channels(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS imports_exports (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_source_sync_runs_source_id
        ON source_sync_runs(source_id);
      CREATE INDEX IF NOT EXISTS idx_source_channels_source_id
        ON source_channels(source_id);
      CREATE INDEX IF NOT EXISTS idx_source_channels_tvg_id
        ON source_channels(tvg_id);
      CREATE INDEX IF NOT EXISTS idx_channel_bindings_source_channel_id
        ON channel_bindings(source_channel_id);
      CREATE INDEX IF NOT EXISTS idx_channel_bindings_canonical_channel_id
        ON channel_bindings(canonical_channel_id);
      CREATE INDEX IF NOT EXISTS idx_guide_bindings_canonical_channel_id
        ON guide_bindings(canonical_channel_id);
      CREATE INDEX IF NOT EXISTS idx_output_profile_channels_output_profile_id
        ON output_profile_channels(output_profile_id);
    `,
  },
  {
    id: '002-channel-mappings',
    sql: `
      CREATE TABLE IF NOT EXISTS channel_mappings (
        key TEXT PRIMARY KEY,
        name TEXT,
        guide_number TEXT,
        tvg_id TEXT,
        logo TEXT,
        stream_url TEXT,
        group_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_channel_mappings_tvg_id
        ON channel_mappings(tvg_id);
    `,
  },
];

let database = null;
let databasePath = null;

function ensureDatabaseDirectory(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
}

function applyPragmas(db, filename) {
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  if (filename !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function applyMigrations(db) {
  ensureMigrationTable(db);

  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map(row => row.id));
  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)'
  );

  const applyMigration = db.transaction(migration => {
    if (applied.has(migration.id)) {
      return;
    }

    db.exec(migration.sql);
    insertMigration.run(migration.id, new Date().toISOString());
  });

  for (const migration of MIGRATIONS) {
    applyMigration(migration);
  }
}

export function getDatabasePath(filename = DEFAULT_DB_FILENAME) {
  return getDataPath(filename);
}

export function initDatabase(options = {}) {
  const filename = options.filename || getDatabasePath();

  if (database) {
    if (databasePath === filename) {
      return database;
    }
    closeDatabase();
  }

  ensureDatabaseDirectory(filename);

  const db = new Database(filename);
  applyPragmas(db, filename);
  applyMigrations(db);

  database = db;
  databasePath = filename;

  return database;
}

export function getDatabase() {
  if (!database) {
    throw new Error('Database not initialized');
  }

  return database;
}

export function closeDatabase() {
  if (!database) {
    return;
  }

  database.close();
  database = null;
  databasePath = null;
}

export function exec(sql) {
  return getDatabase().exec(sql);
}

export function run(sql, params = []) {
  return getDatabase().prepare(sql).run(params);
}

export function get(sql, params = []) {
  return getDatabase().prepare(sql).get(params);
}

export function all(sql, params = []) {
  return getDatabase().prepare(sql).all(params);
}

export function transaction(callback) {
  return getDatabase().transaction(callback);
}

export default {
  all,
  closeDatabase,
  exec,
  get,
  getDatabase,
  getDatabasePath,
  initDatabase,
  run,
  transaction,
};
