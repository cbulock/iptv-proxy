import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

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

/** Build a Basic Auth header value for the given credentials. */
const basicAuthHeader = (user, pass) => ({
  Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
});

function buildApp() {
  const app = express();
  app.use(express.json());
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
    beforeEach(async () => {
      // Set up credentials before each password test
      await axios.post(`${baseUrl}/api/auth/setup`, { username: 'admin', password: 'password123' });
    });

    it('returns 401 when no authorization header is provided', async () => {
      try {
        await axios.put(`${baseUrl}/api/auth/password`, { currentPassword: 'password123', newPassword: 'newpassword456' });
        expect.fail('Expected 401');
      } catch (err) {
        expect(err.response.status).to.equal(401);
      }
    });

    it('successfully updates password with valid credentials', async () => {
      const res = await axios.put(
        `${baseUrl}/api/auth/password`,
        { currentPassword: 'password123', newPassword: 'newpassword456' },
        { headers: basicAuthHeader('admin', 'password123') }
      );
      expect(res.status).to.equal(200);
      expect(res.data).to.deep.equal({ status: 'updated' });
    });

    it('returns 401 when current password is incorrect', async () => {
      try {
        await axios.put(
          `${baseUrl}/api/auth/password`,
          { currentPassword: 'wrongpassword', newPassword: 'newpassword456' },
          { headers: basicAuthHeader('admin', 'password123') }
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
          { headers: basicAuthHeader('admin', 'password123') }
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
          { headers: basicAuthHeader('admin', 'password123') }
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
          { headers: basicAuthHeader('admin', 'password123') }
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
          { headers: basicAuthHeader('admin', 'password123') }
        );
      } catch (err) {
        expect(err.response.data).to.not.have.property('detail');
      }
    });
  });
});
