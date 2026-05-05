import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';
import {
  all,
  closeDatabase,
  get,
  getDatabase,
  initDatabase,
  run,
} from '../../libs/database.js';

describe('database foundation', () => {
  let tempDir;
  let dbPath;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-db-test-'));
    dbPath = path.join(tempDir, 'iptv-proxy.sqlite');
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('initializes a SQLite database file and returns the open connection', async () => {
    const db = initDatabase({ filename: dbPath });

    expect(db).to.equal(getDatabase());

    const stat = await fs.stat(dbPath);
    expect(stat.isFile()).to.equal(true);
  });

  it('creates the planned core tables during bootstrap', () => {
    initDatabase({ filename: dbPath });

    const tables = new Set(
      all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).map(row => row.name)
    );

    expect(Array.from(tables)).to.include.members([
      'app_settings',
      'canonical_channels',
      'channel_bindings',
      'channel_mappings',
      'guide_bindings',
      'imports_exports',
      'oauth_access_tokens',
      'oauth_authorization_codes',
      'output_profile_channels',
      'output_profiles',
      'schema_migrations',
      'source_channels',
      'source_sync_runs',
      'sources',
    ]);
  });

  it('applies migrations only once when initialized repeatedly', () => {
    initDatabase({ filename: dbPath });
    initDatabase({ filename: dbPath });

    const row = get('SELECT COUNT(*) AS count FROM schema_migrations');
    expect(row.count).to.equal(3);
  });

  it('supports the shared run/get helpers for future repositories', () => {
    initDatabase({ filename: dbPath });

    const now = new Date().toISOString();
    run(
      'INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)',
      ['base_url', JSON.stringify('https://example.com'), now]
    );

    const row = get('SELECT key, value_json FROM app_settings WHERE key = ?', ['base_url']);
    expect(row).to.deep.equal({
      key: 'base_url',
      value_json: JSON.stringify('https://example.com'),
    });
  });
});
