import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import session from 'express-session';
import axios from 'axios';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const SESSION_COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE === 'true';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for /api/auth/* endpoints.
//
// We point process.env.CONFIG_PATH at a temporary directory before the
// handlers run so the real config/app.yaml is never touched — even if the
// test process is killed mid-run.  The static authRouter import is fine
// because auth-routes.js now computes getConfigPath('app.yaml') at call
// time (not at module load time), so it picks up CONFIG_PATH dynamically.
// ─────────────────────────────────────────────────────────────────────────────

import authRouter from '../../server/auth-routes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret-for-auth-routes',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: SESSION_COOKIE_SECURE }, // can be enabled via env for HTTPS
    })
  );
  app.use(authRouter);
  return app;
}

async function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

/**
 * Log in via POST /api/auth/login and return the session cookie string,
 * ready to be used in subsequent requests.
 */
async function loginAndGetCookie(baseUrl, username, password) {
  const res = await axios.post(
    `${baseUrl}/api/auth/login`,
    { username, password },
    { withCredentials: true }
  );
  // axios returns Set-Cookie headers in res.headers['set-cookie']
  const setCookie = res.headers['set-cookie'];
  if (!setCookie || !setCookie.length) throw new Error('No session cookie returned from login');
  // Return only the cookie name=value pair (first part before semicolon)
  return setCookie[0].split(';')[0];
}

/** Build Cookie header object from a cookie string. */
const cookieHeader = (cookie) => ({ Cookie: cookie });

describe('Auth Routes Integration', () => {
  let server;
  let baseUrl;
  let tmpDir;
  let originalConfigPath;

  before(async () => {
    // Point CONFIG_PATH at a throwaway temp directory.
    // Handlers call getConfigPath() at runtime, so they pick this up.
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-auth-test-'));
    originalConfigPath = process.env.CONFIG_PATH;
    process.env.CONFIG_PATH = tmpDir;

    const app = buildApp();
    ({ server, baseUrl } = await startServer(app));
  });

  after(async () => {
    await stopServer(server);
    // Restore the original CONFIG_PATH (may be undefined)
    if (originalConfigPath === undefined) {
      delete process.env.CONFIG_PATH;
    } else {
      process.env.CONFIG_PATH = originalConfigPath;
    }
    // Clean up temp directory
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Reset app.yaml to empty before each test so each test starts unconfigured
  beforeEach(async () => {
    await fs.writeFile(path.join(tmpDir, 'app.yaml'), '{}\n', 'utf8');
  });

  // ── GET /api/auth/status ───────────────────────────────────────────────────

  describe('GET /api/auth/status', () => {
    it('returns configured: false when no credentials are set', async () => {
      const res = await axios.get(`${baseUrl}/api/auth/status`);
      expect(res.status).to.equal(200);
      expect(res.data).to.deep.equal({ configured: false });
    });

    it('returns configured: true after credentials are set', async () => {
      await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
      const res = await axios.get(`${baseUrl}/api/auth/status`);
      expect(res.status).to.equal(200);
      expect(res.data).to.deep.equal({ configured: true });
    });
  });

  // ── GET /api/auth/session ──────────────────────────────────────────────────

  describe('GET /api/auth/session', () => {
    it('returns authenticated: false when no session exists', async () => {
      const res = await axios.get(`${baseUrl}/api/auth/session`);
      expect(res.status).to.equal(200);
      expect(res.data).to.deep.equal({ authenticated: false });
    });

    it('returns authenticated: true after a successful login', async () => {
      await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
      const cookie = await loginAndGetCookie(baseUrl, 'admin', 'password123');
      const res = await axios.get(`${baseUrl}/api/auth/session`, { headers: cookieHeader(cookie) });
      expect(res.status).to.equal(200);
      expect(res.data).to.deep.equal({ authenticated: true });
    });
  });

  // ── POST /api/auth/login ───────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
    });

    it('returns 200 and a session cookie with valid credentials', async () => {
      const res = await axios.post(`${baseUrl}/api/auth/login`, { username: 'admin', password: 'password123' });
      expect(res.status).to.equal(200);
      expect(res.data).to.deep.equal({ status: 'ok' });
      expect(res.headers['set-cookie']).to.be.an('array').with.length.greaterThan(0);
    });

    it('returns 401 with invalid credentials', async () => {
      try {
        await axios.post(`${baseUrl}/api/auth/login`, { username: 'admin', password: 'wrong' });
        expect.fail('Expected 401');
      } catch (err) {
        expect(err.response.status).to.equal(401);
      }
    });

    it('returns 400 when username or password is missing', async () => {
      try {
        await axios.post(`${baseUrl}/api/auth/login`, { username: 'admin' });
        expect.fail('Expected 400');
      } catch (err) {
        expect(err.response.status).to.equal(400);
      }
    });
  });

  // ── POST /api/auth/logout ──────────────────────────────────────────────────

  describe('POST /api/auth/logout', () => {
    it('destroys the session and returns logged_out', async () => {
      await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
      const cookie = await loginAndGetCookie(baseUrl, 'admin', 'password123');

      // Confirm we are logged in
      const before = await axios.get(`${baseUrl}/api/auth/session`, { headers: cookieHeader(cookie) });
      expect(before.data.authenticated).to.equal(true);

      // Log out
      const logoutRes = await axios.post(`${baseUrl}/api/auth/logout`, {}, { headers: cookieHeader(cookie) });
      expect(logoutRes.status).to.equal(200);
      expect(logoutRes.data).to.deep.equal({ status: 'logged_out' });

      // The old session cookie should no longer be authenticated
      const after = await axios.get(`${baseUrl}/api/auth/session`, { headers: cookieHeader(cookie) });
      expect(after.data.authenticated).to.equal(false);
    });
  });

  // ── POST /api/auth/setup ───────────────────────────────────────────────────

  describe('POST /api/auth/setup', () => {
    it('returns 200 and saves credentials when auth is not configured', async () => {
      const res = await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
      expect(res.status).to.equal(200);
      expect(res.data).to.deep.equal({ status: 'configured' });

      // Verify the file was written with a hashed password
      const content = await fs.readFile(path.join(tmpDir, 'app.yaml'), 'utf8');
      expect(content).to.include('admin_auth');
      expect(content).to.include('admin');
      expect(content).to.include('$2'); // bcrypt prefix
    });

    it('returns 403 when auth is already configured', async () => {
      await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
      try {
        await axios.post(`${baseUrl}/api/auth/setup`, { username: 'other', password: 'password456' });
        expect.fail('Expected 403');
      } catch (err) {
        expect(err.response.status).to.equal(403);
      }
    });

    it('returns 400 when username is missing', async () => {
      try {
        await axios.post(`${baseUrl}/api/auth/setup`, { password: 'password123' });
        expect.fail('Expected 400');
      } catch (err) {
        expect(err.response.status).to.equal(400);
        expect(err.response.data.error).to.include('Username');
      }
    });

    it('returns 400 when username is empty string', async () => {
      try {
        await axios.post(`${baseUrl}/api/auth/setup`, { username: '   ', password: 'password123' });
        expect.fail('Expected 400');
      } catch (err) {
        expect(err.response.status).to.equal(400);
      }
    });

    it('returns 400 when username exceeds 50 characters', async () => {
      try {
        await axios.post(`${baseUrl}/api/auth/setup`, { username: 'a'.repeat(51), password: 'password123' });
        expect.fail('Expected 400');
      } catch (err) {
        expect(err.response.status).to.equal(400);
        expect(err.response.data.error).to.include('50');
      }
    });

    it('returns 400 when username contains invalid characters', async () => {
      try {
        await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin<script>', password: 'password123' });
        expect.fail('Expected 400');
      } catch (err) {
        expect(err.response.status).to.equal(400);
      }
    });

    it('returns 400 when password is too short', async () => {
      try {
        await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'short' });
        expect.fail('Expected 400');
      } catch (err) {
        expect(err.response.status).to.equal(400);
        expect(err.response.data.error).to.include('8');
      }
    });

    it('returns 400 when password exceeds 128 characters', async () => {
      try {
        await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'a'.repeat(129) });
        expect.fail('Expected 400');
      } catch (err) {
        expect(err.response.status).to.equal(400);
        expect(err.response.data.error).to.include('128');
      }
    });

    it('does not expose internal error details in successful responses', async () => {
      const res = await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
      expect(res.data).to.not.have.property('detail');
    });
  });

  // ── PUT /api/auth/password ─────────────────────────────────────────────────

  describe('PUT /api/auth/password', () => {
    let sessionCookie;

    beforeEach(async () => {
      // Set up credentials before each password test
      await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
      // Obtain a valid session cookie
      sessionCookie = await loginAndGetCookie(baseUrl, 'admin', 'password123');
    });

    it('returns 401 when no session cookie is provided', async () => {
      try {
        await axios.put(`${baseUrl}/api/auth/password`, { currentPassword: 'password123', newPassword: 'newpassword456' });
        expect.fail('Expected 401');
      } catch (err) {
        expect(err.response.status).to.equal(401);
      }
    });

    it('successfully updates password with a valid session', async () => {
      const res = await axios.put(
        `${baseUrl}/api/auth/password`,
        { currentPassword: 'password123', newPassword: 'newpassword456' },
        { headers: cookieHeader(sessionCookie) }
      );
      expect(res.status).to.equal(200);
      expect(res.data).to.deep.equal({ status: 'updated' });
    });

    it('returns 401 when current password is incorrect', async () => {
      try {
        await axios.put(
          `${baseUrl}/api/auth/password`,
          { currentPassword: 'wrongpassword', newPassword: 'newpassword456' },
          { headers: cookieHeader(sessionCookie) }
        );
        expect.fail('Expected 401');
      } catch (err) {
        expect(err.response.status).to.equal(401);
        expect(err.response.data.error).to.include('incorrect');
      }
    });

    it('returns 400 when new password is too short', async () => {
      try {
        await axios.put(
          `${baseUrl}/api/auth/password`,
          { currentPassword: 'password123', newPassword: 'short' },
          { headers: cookieHeader(sessionCookie) }
        );
        expect.fail('Expected 400');
      } catch (err) {
        expect(err.response.status).to.equal(400);
      }
    });

    it('returns 400 when new password exceeds 128 characters', async () => {
      try {
        await axios.put(
          `${baseUrl}/api/auth/password`,
          { currentPassword: 'password123', newPassword: 'a'.repeat(129) },
          { headers: cookieHeader(sessionCookie) }
        );
        expect.fail('Expected 400');
      } catch (err) {
        expect(err.response.status).to.equal(400);
        expect(err.response.data.error).to.include('128');
      }
    });

    it('returns 400 when currentPassword field is missing', async () => {
      try {
        await axios.put(
          `${baseUrl}/api/auth/password`,
          { newPassword: 'newpassword456' },
          { headers: cookieHeader(sessionCookie) }
        );
        expect.fail('Expected 400');
      } catch (err) {
        expect(err.response.status).to.equal(400);
      }
    });

    it('does not expose internal error details in error responses', async () => {
      try {
        await axios.put(
          `${baseUrl}/api/auth/password`,
          { currentPassword: 'wrongpassword', newPassword: 'newpassword456' },
          { headers: cookieHeader(sessionCookie) }
        );
      } catch (err) {
        expect(err.response.data).to.not.have.property('detail');
      }
    });
  });
});
