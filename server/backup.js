import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import archiver from 'archiver';
import { getConfigPath, getDataPath } from '../libs/paths.js';
import { requireAuth, invalidateAuthCache } from './auth.js';
import { closeDatabase, getDatabasePath, initDatabase } from '../libs/database.js';
import { ensureAppConfigSeeded, loadAppConfigFromStore, replaceAppConfig } from '../libs/app-settings-service.js';
import {
  ensureSourcesSeeded,
  loadProvidersConfigFromStore,
  replaceProvidersConfig,
} from '../libs/source-service.js';
import {
  ensureChannelMapSeeded,
  loadChannelMapFromStore,
  replaceChannelMap,
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

/** Ensure the backups directory exists. */
async function ensureBackupsDir() {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
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
  await ensureBackupsDir();
  ensureSourcesSeeded();
  ensureChannelMapSeeded();
  ensureAppConfigSeeded();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupName = `backup-${timestamp}`;
  const backupDir = path.join(BACKUPS_DIR, backupName);

  await fs.mkdir(backupDir, { recursive: true });
  closeDatabase();

  try {
    const copied = [];
    for (const file of [...PRIMARY_CONFIG_FILES, ...LEGACY_COMPAT_CONFIG_FILES]) {
      const src = getConfigPath(file);
      if (fsSync.existsSync(src)) {
        await fs.copyFile(src, path.join(backupDir, file));
        copied.push(file);
      }
    }

    for (const file of RUNTIME_BACKUP_FILES) {
      const src = getDataPath(file);
      if (fsSync.existsSync(src)) {
        await fs.copyFile(src, path.join(backupDir, file));
        copied.push(file);
      }
    }

    return { name: backupName, files: copied };
  } finally {
    initDatabase();
  }
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

    if (hasDatabaseSnapshot) {
      closeDatabase();

      for (const file of [...PRIMARY_CONFIG_FILES, ...DATABASE_RUNTIME_FILES]) {
        await fs.rm(file.endsWith('.yaml') ? getConfigPath(file) : getDataPath(file), {
          force: true,
        });
      }
    }

    const restored = [];
    for (const file of filesInBackup) {
      if (
        hasDatabaseSnapshot &&
        PRIMARY_CONFIG_FILES.includes(file) &&
        !LEGACY_COMPAT_CONFIG_FILES.includes(file)
      ) {
        continue;
      }

      if (![...PRIMARY_CONFIG_FILES, ...LEGACY_COMPAT_CONFIG_FILES, ...RUNTIME_BACKUP_FILES].includes(file)) {
        continue;
      }

      const src = path.join(backupDir, file);
      if (fsSync.existsSync(src)) {
        const dest = [...PRIMARY_CONFIG_FILES, ...LEGACY_COMPAT_CONFIG_FILES].includes(file)
          ? getConfigPath(file)
          : getDataPath(file);
        await fs.copyFile(src, dest);
        restored.push(file);
      }
    }

    if (hasDatabaseSnapshot) {
      initDatabase();
      replaceProvidersConfig(loadProvidersConfigFromStore());
      replaceChannelMap(loadChannelMapFromStore());
      replaceAppConfig(loadAppConfigFromStore());
      restored.push(...PRIMARY_CONFIG_FILES.filter(file => !restored.includes(file)));
    }

    // If app config was restored, the in-process auth config cache may now be stale.
    if (restored.includes('app.yaml') || hasDatabaseSnapshot) {
      invalidateAuthCache();
    }

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
