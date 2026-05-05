import crypto from 'crypto';
import { loadAppConfigFromStore } from './app-settings-service.js';
import { getDatabase, initDatabase, transaction } from './database.js';

const DEFAULT_SCOPE = 'mcp';
const DEFAULT_AUTHORIZATION_CODE_TTL_SECONDS = 300;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 3600;

function ensureDatabaseReady() {
  return initDatabase();
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function sha256Base64Url(value) {
  return base64Url(crypto.createHash('sha256').update(String(value), 'utf8').digest());
}

function nowIso() {
  return new Date().toISOString();
}

function expiresAtIso(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function normalizeScope(scope) {
  const items = String(scope || DEFAULT_SCOPE)
    .split(/\s+/)
    .map(item => item.trim())
    .filter(Boolean);
  return Array.from(new Set(items)).join(' ');
}

function scopeIncludes(scope, requiredScope) {
  return String(scope || '')
    .split(/\s+/)
    .filter(Boolean)
    .includes(requiredScope);
}

function sanitizeOauthClient(rawClient) {
  if (!rawClient || typeof rawClient !== 'object') {
    return null;
  }

  const clientId = String(rawClient.client_id || '').trim();
  const redirectUris = Array.isArray(rawClient.redirect_uris)
    ? rawClient.redirect_uris
      .map(uri => String(uri || '').trim())
      .filter(Boolean)
    : [];

  if (!clientId || redirectUris.length === 0) {
    return null;
  }

  return {
    client_id: clientId,
    client_name: String(rawClient.client_name || clientId).trim(),
    redirect_uris: redirectUris,
    scope: normalizeScope(rawClient.scope || DEFAULT_SCOPE),
    token_endpoint_auth_method: 'none',
  };
}

function getOAuthConfig() {
  const appConfig = loadAppConfigFromStore() || {};
  const oauth = appConfig.oauth || {};
  return {
    issuer: typeof oauth.issuer === 'string' ? oauth.issuer.trim() : '',
    authorizationCodeTtlSeconds:
      Number.isInteger(oauth.authorization_code_ttl_seconds) &&
      oauth.authorization_code_ttl_seconds > 0
        ? oauth.authorization_code_ttl_seconds
        : DEFAULT_AUTHORIZATION_CODE_TTL_SECONDS,
    accessTokenTtlSeconds:
      Number.isInteger(oauth.access_token_ttl_seconds) && oauth.access_token_ttl_seconds > 0
        ? oauth.access_token_ttl_seconds
        : DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    clients: Array.isArray(oauth.clients) ? oauth.clients.map(sanitizeOauthClient).filter(Boolean) : [],
  };
}

export function listOAuthClients() {
  return getOAuthConfig().clients;
}

export function getOAuthClient(clientId) {
  return listOAuthClients().find(client => client.client_id === clientId) || null;
}

export function isOAuthEnabled() {
  return listOAuthClients().length > 0;
}

export function getOAuthIssuerOverride() {
  return getOAuthConfig().issuer || '';
}

export function getOAuthServerSettings() {
  const config = getOAuthConfig();
  return {
    accessTokenTtlSeconds: config.accessTokenTtlSeconds,
    authorizationCodeTtlSeconds: config.authorizationCodeTtlSeconds,
  };
}

export function createAuthorizationCode({
  clientId,
  redirectUri,
  scope = DEFAULT_SCOPE,
  username,
  codeChallenge,
  codeChallengeMethod = 'S256',
}) {
  ensureDatabaseReady();

  const code = base64Url(crypto.randomBytes(32));
  const timestamp = nowIso();
  const expiresAt = expiresAtIso(getOAuthServerSettings().authorizationCodeTtlSeconds);

  getDatabase()
    .prepare(
      `INSERT INTO oauth_authorization_codes (
        code_hash,
        client_id,
        redirect_uri,
        scope,
        username,
        code_challenge,
        code_challenge_method,
        created_at,
        expires_at,
        consumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      sha256(code),
      clientId,
      redirectUri,
      normalizeScope(scope),
      username,
      codeChallenge,
      codeChallengeMethod,
      timestamp,
      expiresAt
    );

  return code;
}

function verifyPkce({ verifier, challenge, method }) {
  if (!verifier || !challenge) {
    return false;
  }

  if (method === 'plain') {
    return verifier === challenge;
  }

  if (method === 'S256') {
    return sha256Base64Url(verifier) === challenge;
  }

  return false;
}

export function exchangeAuthorizationCode({
  code,
  clientId,
  redirectUri,
  codeVerifier,
}) {
  ensureDatabaseReady();

  const db = getDatabase();
  const consumeCode = transaction(() => {
    const row = db
      .prepare(
        `SELECT
            code_hash,
            client_id,
            redirect_uri,
            scope,
            username,
            code_challenge,
            code_challenge_method,
            expires_at,
            consumed_at
         FROM oauth_authorization_codes
         WHERE code_hash = ?`
      )
      .get(sha256(code));

    if (!row) {
      return { error: 'invalid-code' };
    }

    if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
      return { error: 'invalid-code' };
    }

    if (row.consumed_at) {
      return { error: 'invalid-code' };
    }

    if (Date.parse(row.expires_at) <= Date.now()) {
      return { error: 'expired-code' };
    }

    if (
      !verifyPkce({
        verifier: codeVerifier,
        challenge: row.code_challenge,
        method: row.code_challenge_method,
      })
    ) {
      return { error: 'invalid-code-verifier' };
    }

    const consumeResult = db
      .prepare(
        `UPDATE oauth_authorization_codes
            SET consumed_at = ?
          WHERE code_hash = ?
            AND consumed_at IS NULL`
      )
      .run(nowIso(), row.code_hash);

    if (consumeResult.changes === 0) {
      return { error: 'invalid-code' };
    }

    return {
      clientId: row.client_id,
      scope: row.scope,
      username: row.username,
    };
  });

  const result = consumeCode();
  if (result?.error) {
    return result;
  }

  return createAccessToken({
    clientId: result.clientId,
    scope: result.scope,
    username: result.username,
  });
}

export function createAccessToken({ clientId, scope = DEFAULT_SCOPE, username }) {
  ensureDatabaseReady();

  const token = base64Url(crypto.randomBytes(32));
  const timestamp = nowIso();
  const expiresAt = expiresAtIso(getOAuthServerSettings().accessTokenTtlSeconds);

  getDatabase()
    .prepare(
      `INSERT INTO oauth_access_tokens (
        token_hash,
        client_id,
        scope,
        username,
        created_at,
        expires_at,
        revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(sha256(token), clientId, normalizeScope(scope), username, timestamp, expiresAt);

  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: getOAuthServerSettings().accessTokenTtlSeconds,
    scope: normalizeScope(scope),
  };
}

export function authenticateAccessToken(token, requiredScope = DEFAULT_SCOPE) {
  ensureDatabaseReady();

  const row = getDatabase()
    .prepare(
      `SELECT
          client_id,
          scope,
          username,
          created_at,
          expires_at,
          revoked_at
       FROM oauth_access_tokens
       WHERE token_hash = ?`
    )
    .get(sha256(token));

  if (!row) {
    return null;
  }

  if (row.revoked_at) {
    return null;
  }

  if (Date.parse(row.expires_at) <= Date.now()) {
    return null;
  }

  if (requiredScope && !scopeIncludes(row.scope, requiredScope)) {
    return null;
  }

  return {
    clientId: row.client_id,
    scope: row.scope,
    username: row.username,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function revokeAccessToken(token) {
  ensureDatabaseReady();

  const result = getDatabase()
    .prepare(
      `UPDATE oauth_access_tokens
          SET revoked_at = ?
        WHERE token_hash = ?
          AND revoked_at IS NULL`
    )
    .run(nowIso(), sha256(token));

  return result.changes > 0;
}

export default {
  authenticateAccessToken,
  createAccessToken,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  getOAuthClient,
  getOAuthIssuerOverride,
  getOAuthServerSettings,
  isOAuthEnabled,
  listOAuthClients,
  revokeAccessToken,
};
