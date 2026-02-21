import { loadConfig } from '../libs/config-loader.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

/**
 * Load admin authentication configuration
 * Returns null if authentication is not configured
 */
function getAuthConfig() {
  try {
    const appConfig = loadConfig('app');
    if (appConfig && appConfig.admin_auth) {
      const { username, password } = appConfig.admin_auth;
      if (username && password) {
        return { username, password };
      }
    }
  } catch (error) {
    // Config file doesn't exist or is invalid - authentication is disabled
  }
  return null;
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
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  
  // Convert strings to buffers for constant-time comparison
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  
  // If lengths differ, pad the shorter one to prevent length-based timing attacks
  if (bufA.length !== bufB.length) {
    // Use a dummy comparison to maintain constant time
    crypto.timingSafeEqual(
      Buffer.alloc(Math.max(bufA.length, bufB.length)),
      Buffer.alloc(Math.max(bufA.length, bufB.length))
    );
    return false;
  }
  
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify credentials against configured admin auth
 * Supports both plaintext passwords (legacy) and bcrypt hashed passwords
 * Uses timing-safe comparison to prevent timing attacks for plaintext passwords
 */
export function verifyCredentials(username, password) {
  const authConfig = getAuthConfig();
  if (!authConfig) {
    return false;
  }
  
  // Check username with timing-safe comparison
  const usernameMatch = timingSafeEqual(authConfig.username, username);
  
  // Check if the stored password is a bcrypt hash
  if (isBcryptHash(authConfig.password)) {
    // Use bcrypt comparison for hashed passwords
    const passwordMatch = bcrypt.compareSync(password, authConfig.password);
    return usernameMatch && passwordMatch;
  } else {
    // Legacy: Use timing-safe comparison for plaintext passwords
    const passwordMatch = timingSafeEqual(authConfig.password, password);
    return usernameMatch && passwordMatch;
  }
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
 * Common authentication logic
 * Returns an object with { authenticated: boolean, username?: string, error?: string }
 */
function authenticateRequest(req) {
  // If auth is not enabled, allow access
  if (!isAuthEnabled()) {
    return { authenticated: true };
  }

  // Check for Authorization header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return { authenticated: false, error: 'missing_auth' };
  }

  // Decode Basic Auth credentials
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, ...passwordParts] = credentials.split(':');
  const password = passwordParts.join(':'); // Handle passwords containing colons

  // Verify credentials
  if (!verifyCredentials(username, password)) {
    return { authenticated: false, error: 'invalid_credentials' };
  }

  return { authenticated: true, username };
}

/**
 * Middleware to check if user is authenticated
 * Checks for Basic Auth header
 */
export function requireAuth(req, res, next) {
  const authResult = authenticateRequest(req);
  
  if (!authResult.authenticated) {
    res.setHeader('WWW-Authenticate', 'Basic realm="IPTV Proxy Admin"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  next();
}

/**
 * Middleware specifically for admin UI pages (serves HTML on auth failure)
 */
export function requireAuthHTML(req, res, next) {
  const authResult = authenticateRequest(req);
  
  if (!authResult.authenticated) {
    res.setHeader('WWW-Authenticate', 'Basic realm="IPTV Proxy Admin"');
    
    const errorTitle = authResult.error === 'invalid_credentials' 
      ? 'Authentication Failed' 
      : 'Authentication Required';
    const errorMessage = authResult.error === 'invalid_credentials'
      ? 'Invalid credentials. Please try again.'
      : 'Please enter your credentials to access the admin interface.';
    
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${errorTitle}</title>
          <style>
            body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            h1 { color: #e74c3c; }
          </style>
        </head>
        <body>
          <h1>${errorTitle}</h1>
          <p>${errorMessage}</p>
        </body>
      </html>
    `);
  }

  next();
}
