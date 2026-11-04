import { describe, it } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import usageRouter, { registerUsage, touchUsage, unregisterUsage } from '../../server/usage.js';
import { closeDatabase, getDatabase, initDatabase } from '../../libs/database.js';
import { isAuthEnabled } from '../../server/auth.js';

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.session = { authenticated: true };
    next();
  });
  app.use(usageRouter);
  return app;
}

async function startServer(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe('Usage Route Integration', () => {
  it('persists completed playback across a database reopen', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-usage-'));
    const filename = path.join(directory, 'usage.sqlite');
    const { server, baseUrl } = await startServer(makeApp());
    const channelId = `persist-${Date.now()}`;
    try {
      isAuthEnabled(); // Warm the auth cache before switching the shared database to this fixture.
      initDatabase({ filename });
      const key = await registerUsage({
        ip: '10.0.0.8',
        channelId,
        userName: 'Viewer',
        userAgent: 'VLC/3',
      });
      unregisterUsage(key);
      expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM playback_history').get().count).to.equal(1);
      expect(getDatabase().prepare('SELECT channel_id FROM playback_history').get().channel_id).to.equal(channelId);
      closeDatabase();
      initDatabase({ filename });
      expect(getDatabase().prepare('SELECT channel_id FROM playback_history').get().channel_id).to.equal(channelId);
      const response = await axios.get(`${baseUrl}/api/usage/history`);
      const entry = response.data.history.find(item => item.channelId === channelId);
      expect(entry).to.include({ ip: '10.0.0.8', userName: 'Viewer', client: 'VLC' });
      expect(entry.startedAt).to.be.a('string');
      expect(entry.endedAt).to.be.a('string');
      expect(entry.durationSeconds).to.be.a('number');
    } finally {
      await new Promise(resolve => server.close(resolve));
      closeDatabase();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records an idle HLS viewer as one playback session', async () => {
    initDatabase();
    const { server, baseUrl } = await startServer(makeApp());
    const channelId = `hls-${Date.now()}`;
    try {
      const first = await registerUsage({ ip: '10.0.0.9', channelId, transient: true });
      const second = await registerUsage({ ip: '10.0.0.9', channelId, transient: true });
      expect(second).to.equal(first);
      const active = await axios.get(`${baseUrl}/api/usage/active`);
      const entry = active.data.active.find(item => item.channelId === channelId);
      expect(entry).to.exist;
      // Force idle without waiting 45 seconds, then let the read endpoint prune it.
      // A fake clock makes the existing lastSeen timestamp older than the idle cutoff.
      const originalNow = Date.now;
      try {
        Date.now = () => originalNow() + 46_000;
        await axios.get(`${baseUrl}/api/usage/history`);
      } finally {
        Date.now = originalNow;
      }
      const history = await axios.get(`${baseUrl}/api/usage/history`);
      expect(history.data.history.filter(item => item.channelId === channelId)).to.have.length(1);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
  it('keeps two authenticated viewers behind the same IP separate and exposes their names', async () => {
    const { server, baseUrl } = await startServer(makeApp());
    const channelId = `usage-identity-${Date.now()}`;
    const keys = [];
    try {
      keys.push(
        await registerUsage({ ip: '10.0.0.1', channelId, userId: 'alice', userName: 'Alice' })
      );
      keys.push(await registerUsage({ ip: '10.0.0.1', channelId, userId: 'bob', userName: 'Bób' }));
      const response = await axios.get(`${baseUrl}/api/usage/active`);
      const entries = response.data.active.filter(entry => entry.channelId === channelId);
      expect(keys[0]).not.to.equal(keys[1]);
      expect(entries.map(entry => [entry.userId, entry.userName])).to.deep.equal([
        ['alice', 'Alice'],
        ['bob', 'Bób'],
      ]);
    } finally {
      for (const key of keys) unregisterUsage(key);
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('keeps a viewer active until both overlapping streams close', async () => {
    const { server, baseUrl } = await startServer(makeApp());
    const channelId = `usage-overlap-${Date.now()}`;
    const first = await registerUsage({ ip: '10.0.0.1', channelId, userId: 'alice' });
    const second = await registerUsage({ ip: '10.0.0.1', channelId, userId: 'alice' });
    try {
      unregisterUsage(first);
      const response = await axios.get(`${baseUrl}/api/usage/active`);
      expect(response.data.active.some(entry => entry.channelId === channelId)).to.equal(true);
    } finally {
      unregisterUsage(second);
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('deduplicates sessions per ip/channel and returns lastSeenAt', async () => {
    const { server, baseUrl } = await startServer(makeApp());

    const channelId = `usage-test-${Date.now()}`;
    let key1 = null;
    let key2 = null;
    try {
      key1 = await registerUsage({ ip: '127.0.0.1', channelId });
      touchUsage(key1);
      key2 = await registerUsage({ ip: '127.0.0.1', channelId });
      touchUsage(key2);

      const response = await axios.get(`${baseUrl}/api/usage/active`);
      const active = Array.isArray(response.data?.active) ? response.data.active : [];
      const entries = active.filter(
        entry => entry.ip === '127.0.0.1' && entry.channelId === channelId
      );

      expect(key2).to.equal(key1);
      expect(entries.length).to.equal(1);
      expect(entries[0].lastSeenAt).to.be.a('string');
    } finally {
      if (key1) unregisterUsage(key1);
      if (key2) unregisterUsage(key2);
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('stores client and userAgent fields in the active usage API response', async () => {
    const { server, baseUrl } = await startServer(makeApp());

    const channelId = `usage-ua-test-${Date.now()}`;
    let key = null;
    try {
      key = await registerUsage({ ip: '127.0.0.2', channelId, userAgent: 'Plex/1.0 (Linux)' });

      const response = await axios.get(`${baseUrl}/api/usage/active`);
      const active = Array.isArray(response.data?.active) ? response.data.active : [];
      const entry = active.find(e => e.ip === '127.0.0.2' && e.channelId === channelId);

      expect(entry).to.exist;
      expect(entry.client).to.equal('Plex');
      expect(entry.userAgent).to.equal('Plex/1.0 (Linux)');
    } finally {
      if (key) unregisterUsage(key);
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('backfills userAgent and client on subsequent registerUsage calls when initially absent', async () => {
    const { server, baseUrl } = await startServer(makeApp());

    const channelId = `usage-backfill-test-${Date.now()}`;
    let key = null;
    try {
      // First registration without a userAgent (e.g. HLS preflight)
      key = await registerUsage({ ip: '127.0.0.3', channelId });

      // Second registration with a userAgent (e.g. persistent stream)
      await registerUsage({ ip: '127.0.0.3', channelId, userAgent: 'Jellyfin/10.8.0 (Linux)' });

      const response = await axios.get(`${baseUrl}/api/usage/active`);
      const active = Array.isArray(response.data?.active) ? response.data.active : [];
      const entry = active.find(e => e.ip === '127.0.0.3' && e.channelId === channelId);

      expect(entry).to.exist;
      expect(entry.client).to.equal('Jellyfin');
      expect(entry.userAgent).to.equal('Jellyfin/10.8.0 (Linux)');
    } finally {
      if (key) unregisterUsage(key);
      await new Promise(resolve => server.close(resolve));
    }
  });
});
