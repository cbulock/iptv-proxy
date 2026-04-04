import { loadConfig } from '../libs/config-loader.js';
import bcrypt from 'bcryptjs';

// Cache auth config to avoid reading disk on every request.
// undefined = not yet loaded; null = loaded but auth is disabled.
let _authConfigCache = undefined;

/**
 * Load admin authentication configuration
 * Returns null if authentication is not configured
 */
function getAuthConfig() {
  if (_authConfigCache !== undefined) return _authConfigCache;
  try {
    const appConfig = loadConfig('app');
    if (appConfig && appConfig.admin_auth) {
      const { username, password } = appConfig.admin_auth;
      if (username && password) {
        _authConfigCache = { username, password };
        return _authConfigCache;
      }
    }
  } catch (error) {
    // Config file doesn't exist or is invalid - authentication is disabled
  }
  _authConfigCache = null;
  return null;
}

/**
 * Invalidate the cached auth config so the next request re-reads app.yaml.
 * Call this after writing app.yaml.
 */
export function invalidateAuthCache() {
  _authConfigCache = undefined;
}

/**
 * Check if a password string is a bcrypt hash
 */
function isBcryptHash(password) {
  // Bcrypt hashes start with $2a$, $2b$, or $2y$ followed by cost factor
  return /^\$2[aby]\$\d{2}\$/.test(password);
}

/**
 * Check if authentication is enabled
 */
export function isAuthEnabled() {
  return getAuthConfig() !== null;
}

/**
 * Verify credentials against configured admin auth
 * Only supports bcrypt hashed passwords for security
 */
export function verifyCredentials(username, password) {
  const authConfig = getAuthConfig();
  if (!authConfig) {
    return false;
  }

  // Verify the stored password is a bcrypt hash
  if (!isBcryptHash(authConfig.password)) {
    console.error(
      'Authentication error: Password in app.yaml must be a bcrypt hash. Use: node scripts/hash-password.js your-password'
    );
    return false;
  }

  // Check username match (case-sensitive)
  if (authConfig.username !== username) {
    return false;
  }

  // Use bcrypt comparison for hashed passwords
  return bcrypt.compareSync(password, authConfig.password);
}

/**
 * Hash a plaintext password using bcrypt
 * @param {string} password - The plaintext password to hash
 * @returns {string} The bcrypt hash
 */
export function hashPassword(password) {
  const saltRounds = 10;
  return bcrypt.hashSync(password, saltRounds);
}

/**
 * Middleware to check if user is authenticated via session.
 * When authentication is enabled, returns 401 JSON if the session is not authenticated.
 * When authentication is disabled, always allows access.
 */
export function requireAuth(req, res, next) {
  // If auth is not enabled, allow access
  if (!isAuthEnabled()) {
    return next();
  }

  if (!req.session?.authenticated) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  next();
}

/**
 * Middleware specifically for admin UI pages.
 * Redirects to /admin/login when the user has no valid session.
 * The /login sub-path itself is always allowed through.
 */
export function requireAuthHTML(req, res, next) {
  // If auth is not enabled, allow access
  if (!isAuthEnabled()) {
    return next();
  }

  // The login page must always be reachable (req.path is relative to mount point)
  if (req.path === '/login') {
    return next();
  }

  if (!req.session?.authenticated) {
    const redirect = encodeURIComponent(req.originalUrl);
    return res.redirect(`/admin/login?redirect=${redirect}`);
  }

  next();
}
