import crypto from 'crypto';
import express from 'express';
import RateLimit from 'express-rate-limit';
import { isAuthEnabled } from './auth.js';
import {
  authenticateAccessToken,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  getOAuthClient,
  getOAuthIssuerOverride,
  isOAuthEnabled,
  registerOAuthClient,
  revokeOAuthToken,
} from '../libs/oauth-service.js';
import { loadAppConfigFromStore } from '../libs/app-settings-service.js';
import resolveRequestBaseUrl from '../libs/getBaseUrl.js';

const router = express.Router();

router.use(express.urlencoded({ extended: false }));

const oauthLimiter = RateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skip: req => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: req => req.ip || 'unknown',
  message: { error: 'Too many OAuth requests, please try again later.' },
});

function getBaseUrl(req) {
  const oauthIssuer = getOAuthIssuerOverride();
  if (oauthIssuer) {
    return oauthIssuer.replace(/\/+$/, '');
  }

  const appConfig = loadAppConfigFromStore() || {};
  if (typeof appConfig.base_url === 'string' && appConfig.base_url.trim()) {
    return appConfig.base_url.trim().replace(/\/+$/, '');
  }

  return resolveRequestBaseUrl(req).replace(/\/+$/, '');
}

function getMetadata(req) {
  const issuer = getBaseUrl(req);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256', 'plain'],
    scopes_supported: ['mcp'],
  };
}

function sendTokenError(res, status, error, description) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.status(status).json({
    error,
    error_description: description,
  });
}

function redirectWithParams(baseUrl, params) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function redirectAuthorizeError(res, redirectUri, error, state, description) {
  res.redirect(
    302,
    redirectWithParams(redirectUri, {
      error,
      error_description: description,
      state,
    })
  );
}

function normalizeRequestedScope(scope, client) {
  return String(scope || client.scope || 'mcp')
    .split(/\s+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function clientAllowsRequestedScopes(client, requestedScopes) {
  const allowed = new Set(
    String(client.scope || 'mcp')
      .split(/\s+/)
      .filter(Boolean)
  );

  return requestedScopes.every(scope => allowed.has(scope));
}

function validRedirectUri(uri) {
  if (typeof uri !== 'string' || uri.length > 2048) return false;
  try {
    const parsed = new URL(uri);
    if (parsed.hash || parsed.username || parsed.password || parsed.toString() !== uri)
      return false;
    if (parsed.protocol === 'https:') return true;
    return (
      parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
  );
}

function bearerChallenge(req) {
  const metadata = getMetadata(req);
  return `Bearer realm="iptv-proxy", resource_metadata="${metadata.issuer}/.well-known/oauth-protected-resource/mcp", authorization_uri="${metadata.authorization_endpoint}"`;
}

export function requireMcpBearerAuth(req, res, next) {
  if (!isAuthEnabled()) {
    return next();
  }

  const authorization = req.get('authorization') || '';
  const [scheme, token] = authorization.split(/\s+/, 2);

  if (!isOAuthEnabled()) {
    // A once-valid bearer token must be rejected as invalid when its final
    // client is disabled or removed, rather than presenting a configuration
    // error to an authenticated caller.
    if (scheme === 'Bearer' && token) {
      res.setHeader('WWW-Authenticate', `${bearerChallenge(req)}, error="invalid_token"`);
      return res.status(401).json({ error: 'Invalid or expired bearer token' });
    }
    return res.status(503).json({
      error:
        'OAuth is not configured for MCP access. Add oauth.clients to app.yaml or the app settings store.',
    });
  }

  if (scheme !== 'Bearer' || !token) {
    res.setHeader('WWW-Authenticate', bearerChallenge(req));
    return res.status(401).json({ error: 'Bearer token required' });
  }

  const authContext = authenticateAccessToken(token, 'mcp');
  if (!authContext) {
    res.setHeader('WWW-Authenticate', `${bearerChallenge(req)}, error="invalid_token"`);
    return res.status(401).json({ error: 'Invalid or expired bearer token' });
  }

  req.oauth = authContext;
  next();
}

router.get('/.well-known/oauth-authorization-server', oauthLimiter, (req, res) => {
  if (!isOAuthEnabled()) {
    return res.status(404).json({ error: 'OAuth is not configured' });
  }

  res.json(getMetadata(req));
});

router.get('/.well-known/openid-configuration', oauthLimiter, (req, res) => {
  if (!isOAuthEnabled()) {
    return res.status(404).json({ error: 'OAuth is not configured' });
  }

  res.json(getMetadata(req));
});

router.get('/.well-known/oauth-protected-resource/mcp', oauthLimiter, (req, res) => {
  if (!isOAuthEnabled()) {
    return res.status(404).json({ error: 'OAuth is not configured' });
  }

  const metadata = getMetadata(req);
  res.json({
    resource: `${metadata.issuer}/mcp`,
    authorization_servers: [metadata.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  });
});

router.post('/oauth/register', oauthLimiter, (req, res) => {
  if (!isAuthEnabled()) {
    return res.status(503).json({ error: 'Admin authentication must be configured.' });
  }
  const body = req.body || {};
  const uris = body.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length < 1 ||
    uris.length > 5 ||
    new Set(uris).size !== uris.length ||
    !uris.every(validRedirectUri) ||
    (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none') ||
    (body.scope && body.scope !== 'mcp') ||
    (body.grant_types &&
      (!Array.isArray(body.grant_types) ||
        body.grant_types.some(
          value => !['authorization_code', 'refresh_token'].includes(value)
        ))) ||
    (body.response_types &&
      (!Array.isArray(body.response_types) || body.response_types.some(value => value !== 'code')))
  ) {
    return res.status(400).json({ error: 'invalid_client_metadata' });
  }
  const client = registerOAuthClient({
    clientName: body.client_name,
    redirectUris: uris,
    scope: 'mcp',
  });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(201).json({
    client_id: client.client_id,
    client_name: client.client_name,
    redirect_uris: client.redirect_uris,
    scope: client.scope,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
});

router.get('/oauth/authorize', oauthLimiter, (req, res) => {
  if (!isOAuthEnabled()) {
    return res.status(404).send('OAuth is not configured.');
  }

  if (!isAuthEnabled()) {
    return res
      .status(503)
      .send('Admin authentication must be configured before OAuth can be used.');
  }

  const responseType = String(req.query.response_type || '');
  const clientId = String(req.query.client_id || '');
  const redirectUri = String(req.query.redirect_uri || '');
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const codeChallenge = String(req.query.code_challenge || '');
  const codeChallengeMethod = String(req.query.code_challenge_method || 'S256');
  const client = getOAuthClient(clientId);

  if (!client) {
    return res.status(400).send('Unknown OAuth client.');
  }

  if (!client.redirect_uris.includes(redirectUri)) {
    return res.status(400).send('Invalid redirect URI.');
  }

  if (responseType !== 'code') {
    return redirectAuthorizeError(
      res,
      redirectUri,
      'unsupported_response_type',
      state,
      'Only response_type=code is supported.'
    );
  }

  if (!codeChallenge) {
    return redirectAuthorizeError(
      res,
      redirectUri,
      'invalid_request',
      state,
      'code_challenge is required.'
    );
  }

  if (!['S256', 'plain'].includes(codeChallengeMethod)) {
    return redirectAuthorizeError(
      res,
      redirectUri,
      'invalid_request',
      state,
      'Unsupported code_challenge_method.'
    );
  }

  const requestedScopes = normalizeRequestedScope(req.query.scope, client);
  if (!clientAllowsRequestedScopes(client, requestedScopes)) {
    return redirectAuthorizeError(
      res,
      redirectUri,
      'invalid_scope',
      state,
      'Requested scope is not allowed for this client.'
    );
  }

  if (!req.session?.authenticated || !req.session?.username) {
    const redirect = encodeURIComponent(req.originalUrl);
    return res.redirect(`/admin/login?redirect=${redirect}`);
  }

  if (client.dynamic) {
    const nonce = crypto.randomBytes(24).toString('base64url');
    req.session.oauthConsent = {
      nonce,
      clientId: client.client_id,
      redirectUri,
      state,
      scope: requestedScopes.join(' '),
      codeChallenge,
      codeChallengeMethod,
      username: req.session.username,
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    return res
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><title>Authorize MCP client</title></head><body><h1>Authorize MCP client</h1><p><strong>${escapeHtml(client.client_name)}</strong> requests access to IPTV Proxy MCP tools as ${escapeHtml(req.session.username)}.</p><p>Redirect: ${escapeHtml(redirectUri)}</p><p>This includes tools that can change IPTV settings. Only approve clients you trust.</p><form method="post" action="/oauth/authorize/decision"><input type="hidden" name="nonce" value="${nonce}"><button name="decision" value="approve">Approve</button><button name="decision" value="deny">Deny</button></form></body></html>`
      );
  }

  const code = createAuthorizationCode({
    clientId: client.client_id,
    redirectUri,
    scope: requestedScopes.join(' '),
    username: req.session.username,
    codeChallenge,
    codeChallengeMethod,
  });

  return res.redirect(
    302,
    redirectWithParams(redirectUri, {
      code,
      state,
    })
  );
});

router.post('/oauth/authorize/decision', oauthLimiter, (req, res) => {
  const pending = req.session?.oauthConsent;
  if (
    !pending ||
    !req.session.authenticated ||
    req.session.username !== pending.username ||
    req.body?.nonce !== pending.nonce
  ) {
    return res.status(403).send('Invalid authorization decision.');
  }
  delete req.session.oauthConsent;
  const client = getOAuthClient(pending.clientId);
  if (!client?.dynamic || !client.redirect_uris.includes(pending.redirectUri)) {
    return res.status(400).send('Client is no longer registered.');
  }
  if (req.body.decision !== 'approve') {
    return redirectAuthorizeError(
      res,
      pending.redirectUri,
      'access_denied',
      pending.state,
      'Authorization was denied.'
    );
  }
  const code = createAuthorizationCode({
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    scope: pending.scope,
    username: pending.username,
    codeChallenge: pending.codeChallenge,
    codeChallengeMethod: pending.codeChallengeMethod,
  });
  return res.redirect(302, redirectWithParams(pending.redirectUri, { code, state: pending.state }));
});

router.post('/oauth/token', oauthLimiter, (req, res) => {
  if (!isOAuthEnabled()) {
    return sendTokenError(res, 404, 'invalid_request', 'OAuth is not configured.');
  }

  if (!isAuthEnabled()) {
    return sendTokenError(
      res,
      503,
      'server_error',
      'Admin authentication must be configured before OAuth can be used.'
    );
  }

  const grantType = String(req.body?.grant_type || '');
  const code = String(req.body?.code || '');
  const clientId = String(req.body?.client_id || '');
  const redirectUri = String(req.body?.redirect_uri || '');
  const codeVerifier = String(req.body?.code_verifier || '');
  const client = getOAuthClient(clientId);

  if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
    return sendTokenError(
      res,
      400,
      'unsupported_grant_type',
      'Only authorization_code and refresh_token are supported.'
    );
  }

  if (!client) {
    return sendTokenError(res, 401, 'invalid_client', 'Unknown client_id.');
  }

  if (grantType === 'refresh_token') {
    const refreshToken = String(req.body?.refresh_token || '');
    if (!refreshToken) {
      return sendTokenError(res, 400, 'invalid_request', 'refresh_token is required.');
    }
    const tokenResponse = exchangeRefreshToken({ refreshToken, clientId });
    if (tokenResponse?.error) {
      return sendTokenError(res, 400, 'invalid_grant', 'Refresh token is invalid or expired.');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    return res.json(tokenResponse);
  }

  if (!client.redirect_uris.includes(redirectUri)) {
    return sendTokenError(
      res,
      400,
      'invalid_grant',
      'redirect_uri does not match the original request.'
    );
  }

  if (!code || !codeVerifier) {
    return sendTokenError(res, 400, 'invalid_request', 'code and code_verifier are required.');
  }

  const tokenResponse = exchangeAuthorizationCode({
    code,
    clientId,
    redirectUri,
    codeVerifier,
  });

  if (tokenResponse?.error === 'invalid-code' || tokenResponse?.error === 'expired-code') {
    return sendTokenError(res, 400, 'invalid_grant', 'Authorization code is invalid or expired.');
  }

  if (tokenResponse?.error === 'invalid-code-verifier') {
    return sendTokenError(
      res,
      400,
      'invalid_grant',
      'code_verifier did not match the original code_challenge.'
    );
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.json(tokenResponse);
});

router.post('/oauth/revoke', oauthLimiter, (req, res) => {
  if (!isOAuthEnabled()) {
    return res.status(404).json({ error: 'OAuth is not configured' });
  }

  const token = String(req.body?.token || '');
  if (token) {
    revokeOAuthToken(token);
  }

  res.status(200).send('');
});

export default router;
