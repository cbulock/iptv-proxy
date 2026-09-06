import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import archiver from 'archiver';
import yaml from 'yaml';
import { getConfigPath, getDataPath } from '../libs/paths.js';
import { requireAuth, invalidateAuthCache } from './auth.js';
import { closeDatabase, getDatabase, getDatabasePath, initDatabase } from '../libs/database.js';
import { invalidateCache } from '../libs/channels-cache.js';
import { invalidateLineupCaches } from './lineup.js';
import { invalidateEPGCache } from './epg.js';
import { ensureAppConfigSeeded } from '../libs/app-settings-service.js';
import {
  ensureSourcesSeeded,
} from '../libs/source-service.js';
import {
  ensureChannelMapSeeded,
} from '../libs/channel-map-service.js';

const router = express.Router();

const PRIMARY_CONFIG_FILES = ['providers.yaml', 'app.yaml', 'channel-map.yaml'];
const LEGACY_COMPAT_CONFIG_FILES = ['m3u.yaml', 'epg.yaml'];
const DATABASE_FILENAME = path.basename(getDatabasePath());
const DATABASE_RUNTIME_FILES = [
  DATABASE_FILENAME,
  `${DATABASE_FILENAME}-wal`,
  `${DATABASE_FILENAME}-shm`,
];
const ADDITIONAL_RUNTIME_FILES = [];
const RUNTIME_BACKUP_FILES = [...DATABASE_RUNTIME_FILES, ...ADDITIONAL_RUNTIME_FILES];
const BACKUPS_DIR = getDataPath('backups');
let backupOperation = Promise.resolve();

function runBackupOperation(operation) {
  const result = backupOperation.then(operation, operation);
  backupOperation = result.catch(() => {});
  return result;
}

/** Ensure the backups directory exists. */
async function ensureBackupsDir() {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
}

function getRuntimePath(file) {
  return [...PRIMARY_CONFIG_FILES, ...LEGACY_COMPAT_CONFIG_FILES].includes(file)
    ? getConfigPath(file)
    : getDataPath(file);
}

async function validateStagedRestore(stageDir, files, hasDatabaseSnapshot) {
  for (const file of files) {
    if ([...PRIMARY_CONFIG_FILES, ...LEGACY_COMPAT_CONFIG_FILES].includes(file)) {
      yaml.parse(await fs.readFile(path.join(stageDir, file), 'utf8'));
    }
  }

  if (hasDatabaseSnapshot) {
    // Import lazily so the normal backup/list endpoints do not open a second DB.
    const { default: Database } = await import('better-sqlite3');
    const stagedDatabase = new Database(path.join(stageDir, DATABASE_FILENAME), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      const integrity = stagedDatabase.pragma('quick_check', { simple: true });
      const foreignKeys = stagedDatabase.pragma('foreign_key_check');
      if (integrity !== 'ok' || foreignKeys.length > 0) {
        throw new Error('Backup database failed integrity validation');
      }
    } finally {
      stagedDatabase.close();
    }
  }
}

function exportPrimaryConfigsFromDatabase() {
  const db = getDatabase();
  const providers = db
    .prepare(
      `SELECT id, name, type, base_url, playlist_url, epg_url, enabled
         FROM sources
        ORDER BY created_at ASC, name ASC`
    )
    .all()
    .map(source => ({
      id: source.id,
      name: source.name,
      url:
        source.type === 'hdhomerun'
          ? source.base_url || source.playlist_url || ''
          : source.playlist_url || source.base_url || '',
      type: source.type || 'm3u',
      ...(source.epg_url ? { epg: source.epg_url } : {}),
      ...(source.enabled === 0 ? { enabled: false } : {}),
    }));
  const channelMap = db
    .prepare(
      `SELECT key, name, guide_number, tvg_id, logo, stream_url, group_name
         FROM channel_mappings
        ORDER BY rowid ASC`
    )
    .all()
    .reduce((map, row) => {
      map[row.key] = {
        ...(row.name ? { name: row.name } : {}),
        ...(row.guide_number ? { number: row.guide_number } : {}),
        ...(row.tvg_id ? { tvg_id: row.tvg_id } : {}),
        ...(row.logo ? { logo: row.logo } : {}),
        ...(row.stream_url ? { url: row.stream_url } : {}),
        ...(row.group_name ? { group: row.group_name } : {}),
      };
      return map;
    }, {});
  const appRow = db
    .prepare("SELECT value_json FROM app_settings WHERE key = 'app-config'")
    .get();
  let appConfig = {};
  try {
    appConfig = appRow?.value_json ? JSON.parse(appRow.value_json) : {};
  } catch {
    appConfig = {};
  }

  return { providers: { providers }, channelMap, appConfig };
}

async function restoreBackupSnapshot(backupDir, filesInBackup, hasDatabaseSnapshot) {
  const allowedFiles = [
    ...PRIMARY_CONFIG_FILES,
    ...LEGACY_COMPAT_CONFIG_FILES,
    ...RUNTIME_BACKUP_FILES,
  ];
  const files = filesInBackup.filter(file => allowedFiles.includes(file));
  const stageDir = getDataPath(`.restore-stage-${crypto.randomUUID()}`);
  const rollbackDir = getDataPath(`.restore-rollback-${crypto.randomUUID()}`);
  const restored = [];

  await fs.mkdir(stageDir, { recursive: true });
  try {
    for (const file of files) {
      await fs.copyFile(path.join(backupDir, file), path.join(stageDir, file));
    }
    await validateStagedRestore(stageDir, files, hasDatabaseSnapshot);

    const targetFiles = hasDatabaseSnapshot
      ? [
        ...LEGACY_COMPAT_CONFIG_FILES.filter(file => files.includes(file)),
        ...DATABASE_RUNTIME_FILES,
      ]
      : files.filter(file => [...PRIMARY_CONFIG_FILES, ...LEGACY_COMPAT_CONFIG_FILES].includes(file));

    if (hasDatabaseSnapshot) {
      closeDatabase();
    }
    await fs.mkdir(rollbackDir, { recursive: true });

    try {
      for (const file of targetFiles) {
        const destination = getRuntimePath(file);
        if (fsSync.existsSync(destination)) {
          await fs.copyFile(destination, path.join(rollbackDir, file));
        }
      }

      for (const file of targetFiles) {
        const staged = path.join(stageDir, file);
        const destination = getRuntimePath(file);
        if (fsSync.existsSync(staged)) {
          await fs.copyFile(staged, destination);
          restored.push(file);
        } else if (hasDatabaseSnapshot && DATABASE_RUNTIME_FILES.includes(file)) {
          await fs.rm(destination, { force: true });
        }
      }

      if (hasDatabaseSnapshot) {
        initDatabase();
        // The database is authoritative for these compatibility files. Export
        // it directly instead of replaying a destructive configuration replace.
        const configs = exportPrimaryConfigsFromDatabase();
        await fs.writeFile(
          getConfigPath('providers.yaml'),
          yaml.stringify(configs.providers),
          'utf8'
        );
        await fs.writeFile(getConfigPath('channel-map.yaml'), yaml.stringify(configs.channelMap), 'utf8');
        await fs.writeFile(getConfigPath('app.yaml'), yaml.stringify(configs.appConfig), 'utf8');
        for (const file of PRIMARY_CONFIG_FILES) {
          if (!restored.includes(file)) {
            restored.push(file);
          }
        }
      }
    } catch (error) {
      if (hasDatabaseSnapshot) {
        closeDatabase();
      }
      for (const file of targetFiles) {
        const destination = getRuntimePath(file);
        const rollback = path.join(rollbackDir, file);
        if (fsSync.existsSync(rollback)) {
          await fs.copyFile(rollback, destination);
        } else {
          await fs.rm(destination, { force: true });
        }
      }
      throw error;
    } finally {
      if (hasDatabaseSnapshot) {
        initDatabase();
      }
    }

    invalidateAuthCache();
    invalidateEPGCache();
    invalidateLineupCaches();
    await invalidateCache();
    return restored;
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
    await fs.rm(rollbackDir, { recursive: true, force: true });
  }
}

/**
 * Resolve and validate a backup name to a safe absolute path within BACKUPS_DIR.
 * Returns the resolved path, or null if the name is invalid.
 * @param {string} name
 * @returns {string|null}
 */
function resolveBackupPath(name) {
  if (!/^backup-[\dT-]+$/.test(name)) return null;
  const backupsBase = path.resolve(BACKUPS_DIR);
  const resolved = path.resolve(backupsBase, name);
  if (!resolved.startsWith(backupsBase + path.sep)) return null;
  return resolved;
}

/**
 * List all available backups.
 * GET /api/config/backups
 */
router.get('/api/config/backups', requireAuth, async (req, res) => {
  try {
    await ensureBackupsDir();
    const entries = await fs.readdir(BACKUPS_DIR, { withFileTypes: true });
    const backups = entries
      .filter(e => e.isDirectory() && e.name.startsWith('backup-'))
      .map(e => ({ name: e.name }))
      .sort((a, b) => b.name.localeCompare(a.name)); // newest first
    res.json({ backups, count: backups.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list backups', detail: e.message });
  }
});

/**
 * Create a timestamped backup of all config YAML files.
 * @returns {Promise<{name: string, files: string[]}>}
 */
export async function createBackupSnapshot() {
  return runBackupOperation(async () => {
    await ensureBackupsDir();
    const db = initDatabase();
    // Do not reseed populated database state from potentially older YAML just
    // before snapshotting it. Only bootstrap a genuinely empty installation.
    if (db.prepare('SELECT COUNT(*) AS count FROM sources').get().count === 0) {
      ensureSourcesSeeded();
    }
    if (db.prepare('SELECT COUNT(*) AS count FROM channel_mappings').get().count === 0) {
      ensureChannelMapSeeded();
    }
    if (db.prepare('SELECT COUNT(*) AS count FROM app_settings').get().count === 0) {
      ensureAppConfigSeeded();
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `backup-${timestamp}-${crypto.randomInt(100000, 1000000)}`;
    const backupDir = path.join(BACKUPS_DIR, backupName);

    await fs.mkdir(backupDir, { recursive: true });

    const copied = [];
    // SQLite's backup API creates a transactionally consistent snapshot without
    // closing the shared connection or racing a concurrent writer.
    await db.backup(path.join(backupDir, DATABASE_FILENAME));
    copied.push(DATABASE_FILENAME);

    for (const file of [...PRIMARY_CONFIG_FILES, ...LEGACY_COMPAT_CONFIG_FILES]) {
      const src = getConfigPath(file);
      if (fsSync.existsSync(src)) {
        await fs.copyFile(src, path.join(backupDir, file));
        copied.push(file);
      }
    }

    for (const file of RUNTIME_BACKUP_FILES.filter(file => file !== DATABASE_FILENAME)) {
      const src = getDataPath(file);
      if (fsSync.existsSync(src)) {
        await fs.copyFile(src, path.join(backupDir, file));
        copied.push(file);
      }
    }

    return { name: backupName, files: copied };
  });
}

/**
 * Create a timestamped backup of all config YAML files.
 * POST /api/config/backup
 * Response: { status: 'created', name: 'backup-YYYY-MM-DDTHH-mm-ss' }
 */
router.post('/api/config/backup', requireAuth, async (req, res) => {
  try {
    const result = await createBackupSnapshot();
    res.json({ status: 'created', name: result.name, files: result.files });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create backup', detail: e.message });
  }
});

/**
 * Restore config files from a named backup.
 * POST /api/config/backups/:name/restore
 * Response: { status: 'restored', name, files: [...] }
 */
router.post('/api/config/backups/:name/restore', requireAuth, async (req, res) => {
  try {
    const { name } = req.params;

    const backupDir = resolveBackupPath(name);
    if (!backupDir) {
      return res.status(400).json({ error: 'Invalid backup name' });
    }

    let stat;
    try {
      stat = await fs.stat(backupDir);
    } catch {
      return res.status(404).json({ error: 'Backup not found', name });
    }

    if (!stat.isDirectory()) {
      return res.status(404).json({ error: 'Backup not found', name });
    }

    const filesInBackup = await fs.readdir(backupDir);
    const hasDatabaseSnapshot = filesInBackup.includes(DATABASE_FILENAME);
    const restored = await runBackupOperation(() =>
      restoreBackupSnapshot(backupDir, filesInBackup, hasDatabaseSnapshot)
    );

    res.json({ status: 'restored', name, files: restored });
  } catch (e) {
    res.status(500).json({ error: 'Failed to restore backup', detail: e.message });
  }
});

/**
 * Download a named backup as a zip file.
 * GET /api/config/backups/:name/download
 */
router.get('/api/config/backups/:name/download', requireAuth, async (req, res) => {
  try {
    const { name } = req.params;

    const backupDir = resolveBackupPath(name);
    if (!backupDir) {
      return res.status(400).json({ error: 'Invalid backup name' });
    }

    let stat;
    try {
      stat = await fs.stat(backupDir);
    } catch {
      return res.status(404).json({ error: 'Backup not found', name });
    }

    if (!stat.isDirectory()) {
      return res.status(404).json({ error: 'Backup not found', name });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create zip', detail: err.message });
      } else {
        res.destroy(err);
      }
    });
    archive.pipe(res);
    archive.directory(backupDir, false);
    archive.finalize();
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download backup', detail: e.message });
    } else {
      res.destroy(e);
    }
  }
});

/**
 * Delete a named backup.
 * DELETE /api/config/backups/:name
 */
router.delete('/api/config/backups/:name', requireAuth, async (req, res) => {
  try {
    const { name } = req.params;

    const backupDir = resolveBackupPath(name);
    if (!backupDir) {
      return res.status(400).json({ error: 'Invalid backup name' });
    }

    try {
      await fs.stat(backupDir);
    } catch {
      return res.status(404).json({ error: 'Backup not found', name });
    }

    await fs.rm(backupDir, { recursive: true, force: true });
    res.json({ status: 'deleted', name });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete backup', detail: e.message });
  }
});

export default router;
