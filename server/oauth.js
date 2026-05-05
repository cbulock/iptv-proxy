import express from 'express';
import RateLimit from 'express-rate-limit';
import { isAuthEnabled } from './auth.js';
import {
  authenticateAccessToken,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  getOAuthClient,
  getOAuthIssuerOverride,
  isOAuthEnabled,
  revokeAccessToken,
} from '../libs/oauth-service.js';
import { loadAppConfigFromStore } from '../libs/app-settings-service.js';

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

  return `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
}

function getMetadata(req) {
  const issuer = getBaseUrl(req);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
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

function bearerChallenge(req) {
  const metadata = getMetadata(req);
  return `Bearer realm="iptv-proxy", resource_metadata="${metadata.issuer}/.well-known/oauth-protected-resource/mcp", authorization_uri="${metadata.authorization_endpoint}"`;
}

export function requireMcpBearerAuth(req, res, next) {
  if (!isAuthEnabled()) {
    return next();
  }

  if (!isOAuthEnabled()) {
    return res.status(503).json({
      error: 'OAuth is not configured for MCP access. Add oauth.clients to app.yaml or the app settings store.',
    });
  }

  const authorization = req.get('authorization') || '';
  const [scheme, token] = authorization.split(/\s+/, 2);

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

router.get('/oauth/authorize', oauthLimiter, (req, res) => {
  if (!isOAuthEnabled()) {
    return res.status(404).send('OAuth is not configured.');
  }

  if (!isAuthEnabled()) {
    return res.status(503).send('Admin authentication must be configured before OAuth can be used.');
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

  if (grantType !== 'authorization_code') {
    return sendTokenError(
      res,
      400,
      'unsupported_grant_type',
      'Only authorization_code is supported.'
    );
  }

  if (!client) {
    return sendTokenError(res, 401, 'invalid_client', 'Unknown client_id.');
  }

  if (!client.redirect_uris.includes(redirectUri)) {
    return sendTokenError(res, 400, 'invalid_grant', 'redirect_uri does not match the original request.');
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
    return sendTokenError(res, 400, 'invalid_grant', 'code_verifier did not match the original code_challenge.');
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
    revokeAccessToken(token);
  }

  res.status(200).send('');
});

export default router;
