import express from 'express';
import fs from 'fs';
import yaml from 'yaml';
import RateLimit from 'express-rate-limit';
import { isAuthEnabled, hashPassword, verifyCredentials, requireAuth } from './auth.js';
import { loadConfig } from '../libs/config-loader.js';
import { getConfigPath } from '../libs/paths.js';

const router = express.Router();

const APP_PATH = getConfigPath('app.yaml');

// Rate limiter for auth endpoints (more restrictive to limit brute force)
const authLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  skip: (req) => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: (req) => req.ip || 'unknown',
  message: { error: 'Too many authentication requests, please try again later.' },
});

// Simple in-memory write lock to prevent concurrent credential writes
let writeLock = false;

function acquireLock() {
  if (writeLock) return false;
  writeLock = true;
  return true;
}

function releaseLock() {
  writeLock = false;
}

/**
 * GET /api/auth/status
 * Public endpoint — returns whether admin authentication is configured.
 */
router.get('/api/auth/status', authLimiter, (req, res) => {
  res.json({ configured: isAuthEnabled() });
});

/**
 * POST /api/auth/setup
 * Set up initial admin credentials. Only allowed when auth is NOT yet configured.
 */
router.post('/api/auth/setup', authLimiter, (req, res) => {
  if (isAuthEnabled()) {
    return res
      .status(403)
      .json({ error: 'Authentication is already configured. Use the password update endpoint to change credentials.' });
  }

  const { username, password } = req.body || {};
  const trimmedUsername = typeof username === 'string' ? username.trim() : '';

  if (!trimmedUsername) {
    return res.status(400).json({ error: 'Username is required' });
  }

  if (trimmedUsername.length > 50) {
    return res.status(400).json({ error: 'Username must be 50 characters or fewer' });
  }

  if (!/^[a-zA-Z0-9_\-.@]+$/.test(trimmedUsername)) {
    return res.status(400).json({ error: 'Username may only contain letters, numbers, underscores, hyphens, dots, and @ signs' });
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  if (password.length > 128) {
    return res.status(400).json({ error: 'Password must be 128 characters or fewer' });
  }

  if (!acquireLock()) {
    return res.status(409).json({ error: 'Another credential operation is in progress. Please try again.' });
  }

  try {
    // Re-check after acquiring lock in case another request completed setup first
    if (isAuthEnabled()) {
      return res
        .status(403)
        .json({ error: 'Authentication is already configured. Use the password update endpoint to change credentials.' });
    }

    const hashedPassword = hashPassword(password);

    // Read and merge with existing app config to preserve other settings
    let appConfig = {};
    try {
      appConfig = loadConfig('app') || {};
    } catch (_) {
      // Config file may not exist yet; start with empty object
    }

    appConfig.admin_auth = {
      username: trimmedUsername,
      password: hashedPassword,
    };

    fs.writeFileSync(APP_PATH, yaml.stringify(appConfig), 'utf8');
    res.json({ status: 'configured' });
  } catch (e) {
    console.error('Error setting up auth:', e);
    res.status(500).json({ error: 'Failed to save credentials' });
  } finally {
    releaseLock();
  }
});

/**
 * PUT /api/auth/password
 * Update the admin password. Requires current authentication.
 */
router.put('/api/auth/password', authLimiter, requireAuth, (req, res) => {
  // Auth must be configured before a password change can be made
  if (!isAuthEnabled()) {
    return res.status(409).json({ error: 'No authentication is configured. Use POST /api/auth/setup to set credentials first.' });
  }

  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || typeof currentPassword !== 'string') {
    return res.status(400).json({ error: 'Current password is required' });
  }

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  if (newPassword.length > 128) {
    return res.status(400).json({ error: 'New password must be 128 characters or fewer' });
  }

  if (!acquireLock()) {
    return res.status(409).json({ error: 'Another credential operation is in progress. Please try again.' });
  }

  try {
    const appConfig = loadConfig('app') || {};
    const authSection = appConfig.admin_auth || {};

    // Verify current password before allowing the change
    if (!verifyCredentials(authSection.username, currentPassword)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    appConfig.admin_auth = {
      ...authSection,
      password: hashPassword(newPassword),
    };

    fs.writeFileSync(APP_PATH, yaml.stringify(appConfig), 'utf8');
    res.json({ status: 'updated' });
  } catch (e) {
    console.error('Error updating password:', e);
    res.status(500).json({ error: 'Failed to update password' });
  } finally {
    releaseLock();
  }
});

export default router;
