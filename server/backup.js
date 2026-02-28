import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import yaml from 'yaml';
import { getConfigPath, getDataPath } from '../libs/paths.js';
import { requireAuth } from './auth.js';

const router = express.Router();

const CONFIG_FILES = ['providers.yaml', 'm3u.yaml', 'epg.yaml', 'app.yaml', 'channel-map.yaml'];
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
  if (!/^backup-[\dT\-]+$/.test(name)) return null;
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
      .filter((e) => e.isDirectory() && e.name.startsWith('backup-'))
      .map((e) => ({ name: e.name }))
      .sort((a, b) => b.name.localeCompare(a.name)); // newest first
    res.json({ backups, count: backups.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list backups', detail: e.message });
  }
});

/**
 * Create a timestamped backup of all config YAML files.
 * POST /api/config/backup
 * Response: { status: 'created', name: 'backup-YYYY-MM-DDTHH-mm-ss' }
 */
router.post('/api/config/backup', requireAuth, async (req, res) => {
  try {
    await ensureBackupsDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `backup-${timestamp}`;
    const backupDir = path.join(BACKUPS_DIR, backupName);

    await fs.mkdir(backupDir, { recursive: true });

    const copied = [];
    for (const file of CONFIG_FILES) {
      const src = getConfigPath(file);
      if (fsSync.existsSync(src)) {
        await fs.copyFile(src, path.join(backupDir, file));
        copied.push(file);
      }
    }

    res.json({ status: 'created', name: backupName, files: copied });
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

    const restored = [];
    for (const file of CONFIG_FILES) {
      const src = path.join(backupDir, file);
      if (fsSync.existsSync(src)) {
        await fs.copyFile(src, getConfigPath(file));
        restored.push(file);
      }
    }

    res.json({ status: 'restored', name, files: restored });
  } catch (e) {
    res.status(500).json({ error: 'Failed to restore backup', detail: e.message });
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
