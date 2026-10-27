import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { initDatabase, closeDatabase } from '../../libs/database.js';
import SQLiteSessionStore from '../../libs/sqlite-session-store.js';

describe('persistent admin sessions', () => {
  let tempDir;
  let filename;
  let store;
  const savedSession = () => ({
    cookie: { expires: new Date(Date.now() + 60000), originalMaxAge: 60000 },
    authenticated: true,
    username: 'admin',
    csrfToken: 'saved-csrf-token',
  });
  const call = (method, ...args) => promisify(store[method]).call(store, ...args);

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iptv-sessions-'));
    filename = path.join(tempDir, 'sessions.sqlite');
    initDatabase({ filename });
    store = new SQLiteSessionStore();
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function restart() {
    closeDatabase();
    initDatabase({ filename });
    store = new SQLiteSessionStore();
  }

  it('restores authentication and CSRF state after reopening the database', async () => {
    await call('set', 'session-id', savedSession());
    restart();
    expect(await call('get', 'session-id')).to.include({
      authenticated: true,
      username: 'admin',
      csrfToken: 'saved-csrf-token',
    });
  });

  it('keeps logout effective after restart', async () => {
    await call('set', 'session-id', savedSession());
    restart();
    await call('destroy', 'session-id');
    restart();
    expect(await call('get', 'session-id')).to.not.exist;
  });

  it('rejects expired sessions', async () => {
    const expired = savedSession();
    expired.cookie.expires = new Date(Date.now() - 1000);
    await call('set', 'expired', expired);
    expect(await call('get', 'expired')).to.not.exist;
  });

  it('persists touched expiry without overwriting stored authentication', async () => {
    const original = savedSession();
    await call('set', 'session-id', original);
    const touched = savedSession();
    touched.cookie.expires = new Date(Date.now() + 120000);
    touched.authenticated = false;
    await call('touch', 'session-id', touched);
    restart();
    const restored = await call('get', 'session-id');
    expect(restored.authenticated).to.equal(true);
    expect(new Date(restored.cookie.expires).getTime()).to.equal(touched.cookie.expires.getTime());
  });
});
