import crypto from 'crypto';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import session from 'express-session';
import axios from 'axios';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import authRouter from '../../server/auth-routes.js';
import oauthRouter from '../../server/oauth.js';
import { setupMCPRoutes } from '../../server/mcp.js';
import { csrfMiddleware } from '../../server/csrf.js';
import { closeDatabase } from '../../libs/database.js';
import { invalidateAuthCache } from '../../server/auth.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret-for-oauth-routes',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    })
  );
  app.use(csrfMiddleware);
  app.use(authRouter);
  app.use(oauthRouter);
  app.use(express.json());
  setupMCPRoutes(app);
  return app;
}

function startServer(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function stopServer(server) {
  return new Promise(resolve => server.close(resolve));
}

function sha256Base64Url(value) {
  return crypto
    .createHash('sha256')
    .update(String(value), 'utf8')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function loginAndGetCookie(baseUrl, username, password) {
  const res = await axios.post(
    `${baseUrl}/api/auth/login`,
    { username, password },
    { withCredentials: true }
  );
  return {
    cookie: res.headers['set-cookie'][0].split(';')[0],
    csrfToken: res.data.csrfToken,
  };
}

function cookieHeader({ cookie, csrfToken }) {
  return {
    Cookie: cookie,
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
  };
}

function parseSSE(text) {
  const results = [];
  for (const line of String(text).split('\n')) {
    if (line.startsWith('data: ')) {
      results.push(JSON.parse(line.slice(6)));
    }
  }
  return results;
}

describe('OAuth Integration', () => {
  let server;
  let baseUrl;
  let tmpConfigDir;
  let tmpDataDir;
  let originalConfigPath;
  let originalDataPath;

  before(async () => {
    tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-oauth-config-'));
    tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-oauth-data-'));
    originalConfigPath = process.env.CONFIG_PATH;
    originalDataPath = process.env.DATA_PATH;
    process.env.CONFIG_PATH = tmpConfigDir;
    process.env.DATA_PATH = tmpDataDir;

    const app = buildApp();
    ({ server, baseUrl } = await startServer(app));
  });

  after(async () => {
    await stopServer(server);
    closeDatabase();
    if (originalConfigPath === undefined) {
      delete process.env.CONFIG_PATH;
    } else {
      process.env.CONFIG_PATH = originalConfigPath;
    }
    if (originalDataPath === undefined) {
      delete process.env.DATA_PATH;
    } else {
      process.env.DATA_PATH = originalDataPath;
    }
    await fs.rm(tmpConfigDir, { recursive: true, force: true });
    await fs.rm(tmpDataDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    closeDatabase();
    await fs.rm(tmpDataDir, { recursive: true, force: true });
    await fs.mkdir(tmpDataDir, { recursive: true });
    await fs.writeFile(
      path.join(tmpConfigDir, 'app.yaml'),
      [
        'oauth:',
        '  clients:',
        '    - client_id: test-chatgpt',
        '      client_name: Test ChatGPT',
        '      redirect_uris:',
        '        - http://127.0.0.1/callback',
        '      scope: mcp',
        '',
      ].join('\n'),
      'utf8'
    );
    invalidateAuthCache();
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(tmpDataDir, { recursive: true, force: true });
    await fs.mkdir(tmpDataDir, { recursive: true });
    invalidateAuthCache();
  });

  it('publishes OAuth discovery metadata', async () => {
    await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
    const res = await axios.get(`${baseUrl}/.well-known/oauth-authorization-server`);
    expect(res.status).to.equal(200);
    expect(res.data.authorization_endpoint).to.equal(`${baseUrl}/oauth/authorize`);
    expect(res.data.token_endpoint).to.equal(`${baseUrl}/oauth/token`);
    expect(res.data.code_challenge_methods_supported).to.include('S256');
  });

  it('redirects unauthenticated authorize requests to the admin login page', async () => {
    await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
    const res = await axios.get(`${baseUrl}/oauth/authorize`, {
      params: {
        response_type: 'code',
        client_id: 'test-chatgpt',
        redirect_uri: 'http://127.0.0.1/callback',
        scope: 'mcp',
        code_challenge: 'challenge',
        code_challenge_method: 'plain',
      },
      maxRedirects: 0,
      validateStatus: () => true,
    });

    expect(res.status).to.equal(302);
    expect(res.headers.location).to.include('/admin/login?redirect=');
    expect(decodeURIComponent(res.headers.location)).to.include('/oauth/authorize');
  });

  it('completes the authorization-code PKCE flow and authorizes /mcp with bearer tokens', async () => {
    await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
    const sessionInfo = await loginAndGetCookie(baseUrl, 'admin', 'password123');
    const codeVerifier = 'very-secret-code-verifier';
    const codeChallenge = sha256Base64Url(codeVerifier);

    const authorizeRes = await axios.get(`${baseUrl}/oauth/authorize`, {
      params: {
        response_type: 'code',
        client_id: 'test-chatgpt',
        redirect_uri: 'http://127.0.0.1/callback',
        scope: 'mcp',
        state: 'abc123',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
      headers: cookieHeader(sessionInfo),
      maxRedirects: 0,
      validateStatus: () => true,
    });

    expect(authorizeRes.status).to.equal(302);
    const callbackUrl = new URL(authorizeRes.headers.location);
    expect(callbackUrl.origin + callbackUrl.pathname).to.equal('http://127.0.0.1/callback');
    expect(callbackUrl.searchParams.get('state')).to.equal('abc123');
    const code = callbackUrl.searchParams.get('code');
    expect(code).to.be.a('string').with.length.greaterThan(10);

    const tokenRes = await axios.post(
      `${baseUrl}/oauth/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'test-chatgpt',
        code,
        redirect_uri: 'http://127.0.0.1/callback',
        code_verifier: codeVerifier,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    expect(tokenRes.status).to.equal(200);
    expect(tokenRes.data.token_type).to.equal('Bearer');
    expect(tokenRes.data.scope).to.equal('mcp');
    expect(tokenRes.data.access_token).to.be.a('string');

    const unauthenticatedMcp = await axios.post(
      `${baseUrl}/mcp`,
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        responseType: 'text',
        validateStatus: () => true,
      }
    );

    expect(unauthenticatedMcp.status).to.equal(401);
    expect(unauthenticatedMcp.headers['www-authenticate']).to.include('Bearer');

    const mcpRes = await axios.post(
      `${baseUrl}/mcp`,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${tokenRes.data.access_token}`,
        },
        responseType: 'text',
      }
    );

    expect(mcpRes.status).to.equal(200);
    const events = parseSSE(mcpRes.data);
    const toolList = events.find(event => event.id === 2);
    expect(toolList.result.tools.map(tool => tool.name)).to.include('get_agent_workflow');
  });

  it('rejects token exchange when the PKCE verifier does not match', async () => {
    await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
    const sessionInfo = await loginAndGetCookie(baseUrl, 'admin', 'password123');
    const codeVerifier = 'correct-verifier';
    const codeChallenge = sha256Base64Url(codeVerifier);

    const authorizeRes = await axios.get(`${baseUrl}/oauth/authorize`, {
      params: {
        response_type: 'code',
        client_id: 'test-chatgpt',
        redirect_uri: 'http://127.0.0.1/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
      headers: cookieHeader(sessionInfo),
      maxRedirects: 0,
      validateStatus: () => true,
    });

    const code = new URL(authorizeRes.headers.location).searchParams.get('code');
    const tokenRes = await axios.post(
      `${baseUrl}/oauth/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'test-chatgpt',
        code,
        redirect_uri: 'http://127.0.0.1/callback',
        code_verifier: 'wrong-verifier',
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
      }
    );

    expect(tokenRes.status).to.equal(400);
    expect(tokenRes.data.error).to.equal('invalid_grant');
  });
});
