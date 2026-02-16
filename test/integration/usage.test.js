import { describe, it } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import usageRouter, { registerUsage, touchUsage, unregisterUsage } from '../../server/usage.js';

describe('Usage Route Integration', () => {
  it('deduplicates sessions per ip/channel and returns lastSeenAt', async () => {
    const app = express();
    app.use(usageRouter);

    let server = null;
    let baseUrl = '';
    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });

    const channelId = `usage-test-${Date.now()}`;
    let key1 = null;
    try {
      key1 = await registerUsage({ ip: '127.0.0.1', channelId });
      touchUsage(key1);
      const key2 = await registerUsage({ ip: '127.0.0.1', channelId });
      touchUsage(key2);

      const response = await axios.get(`${baseUrl}/api/usage/active`);
      const active = Array.isArray(response.data?.active) ? response.data.active : [];
      const entries = active.filter(entry => entry.ip === '127.0.0.1' && entry.channelId === channelId);

      expect(key2).to.equal(key1);
      expect(entries.length).to.equal(1);
      expect(entries[0].lastSeenAt).to.be.a('string');
    } finally {
      if (key1) unregisterUsage(key1);
      await new Promise(resolve => server.close(resolve));
    }
  });
});
