import crypto from 'crypto';

// Paths that don't require a valid CSRF token (pre-auth or session-creating endpoints)
const CSRF_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/status',
  '/api/auth/session',
  '/api/auth/csrf-token',
]);

// HTTP methods that must carry a CSRF token
const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * Generate a new CSRF token for the session.
 * Returns the existing token if one already exists.
 * @param {import('express').Request} req
 * @returns {string}
 */
export function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

/**
 * Express middleware that validates the X-CSRF-Token header for all
 * mutating requests to /api/* endpoints, except exempt paths.
 *
 * Only applies when auth is enabled (session exists with csrfToken).
 */
export function csrfMiddleware(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
  if (!req.path.startsWith('/api/')) return next();

  // Auth is disabled — no CSRF enforcement needed
  if (!req.session) return next();

  // If the session is authenticated but has no CSRF token, reject the request.
  // This prevents bypassing CSRF checks via old/partial sessions.
  if (req.session.authenticated && !req.session.csrfToken) {
    return res.status(403).json({ error: 'CSRF token missing from session; please log in again' });
  }

  // If the session is not authenticated (no csrfToken because no login), skip —
  // requireAuth will return 401 first for protected routes.
  if (!req.session.csrfToken) return next();

  const token = req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  next();
}
