import { loadConfig } from '../libs/config-loader.js';

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
 * Check if authentication is enabled
 */
export function isAuthEnabled() {
  return getAuthConfig() !== null;
}

/**
 * Verify credentials against configured admin auth
 */
export function verifyCredentials(username, password) {
  const authConfig = getAuthConfig();
  if (!authConfig) {
    return false;
  }
  return authConfig.username === username && authConfig.password === password;
}

/**
 * Middleware to check if user is authenticated
 * Checks for Basic Auth header
 */
export function requireAuth(req, res, next) {
  // If auth is not enabled, allow access
  if (!isAuthEnabled()) {
    return next();
  }

  // Check for Authorization header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    // No auth header, request authentication
    res.setHeader('WWW-Authenticate', 'Basic realm="IPTV Proxy Admin"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Decode Basic Auth credentials
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  // Verify credentials
  if (!verifyCredentials(username, password)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="IPTV Proxy Admin"');
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Authentication successful
  next();
}

/**
 * Middleware specifically for admin UI pages (serves HTML on auth failure)
 */
export function requireAuthHTML(req, res, next) {
  // If auth is not enabled, allow access
  if (!isAuthEnabled()) {
    return next();
  }

  // Check for Authorization header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    // No auth header, request authentication
    res.setHeader('WWW-Authenticate', 'Basic realm="IPTV Proxy Admin"');
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Required</title>
          <style>
            body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            h1 { color: #e74c3c; }
          </style>
        </head>
        <body>
          <h1>Authentication Required</h1>
          <p>Please enter your credentials to access the admin interface.</p>
        </body>
      </html>
    `);
  }

  // Decode Basic Auth credentials
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  // Verify credentials
  if (!verifyCredentials(username, password)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="IPTV Proxy Admin"');
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            h1 { color: #e74c3c; }
          </style>
        </head>
        <body>
          <h1>Authentication Failed</h1>
          <p>Invalid credentials. Please try again.</p>
        </body>
      </html>
    `);
  }

  // Authentication successful
  next();
}
