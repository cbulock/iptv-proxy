import fs from 'fs';
import axios from 'axios';
import { getProxiedImageUrl } from '../libs/proxy-image.js';
import getBaseUrl from '../libs/getBaseUrl.js';

export function setupLineupRoutes(app, config, usageHelpers = {}) {
  const {
    registerUsage = async () => undefined,
    touchUsage = () => undefined,
    unregisterUsage = () => undefined
  } = usageHelpers;
  const loadChannels = () =>
    JSON.parse(fs.readFileSync('./data/channels.json', 'utf8'));

  app.get('/lineup.json', (req, res) => {
    const channels = loadChannels();

    const lineup = channels.map(channel => ({
      GuideNumber: channel.guideNumber || channel.tvg_id || channel.name,
      GuideName: channel.name,
      URL: `${req.protocol}://${req.get('host')}/stream/${encodeURIComponent(channel.source)}/${encodeURIComponent(channel.name)}`
    }));

    res.json(lineup);
  });

  app.get('/lineup.m3u', (req, res) => {
    const channels = loadChannels();
    const tvgIdMap = new Map(); // For deduplication

    const epgUrl = `${getBaseUrl(req)}/xmltv.xml`;
    let output = `#EXTM3U url-tvg="${epgUrl}" x-tvg-url="${epgUrl}"\n`;

    for (const channel of channels) {
      let tvgId = channel.tvg_id || '';
      const originalTvgId = tvgId;

      // Deduplicate tvg-id
      if (tvgIdMap.has(tvgId)) {
        let i = 1;
        while (tvgIdMap.has(`${originalTvgId}_${i}`)) i++;
        tvgId = `${originalTvgId}_${i}`;
      }
      if (tvgId) tvgIdMap.set(tvgId, true);

      const tvgName = channel.name || '';
      const tvgLogo = channel.logo
        ? getProxiedImageUrl(channel.logo, channel.source || 'unknown', req)
        : '';
      const groupTitle = channel.source || '';
      const streamUrl = `${getBaseUrl(req)}/stream/${encodeURIComponent(channel.source)}/${encodeURIComponent(channel.name)}`;

      output += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${tvgName}" tvg-logo="${tvgLogo}" group-title="${groupTitle}",${tvgName}\n`;
      output += `${streamUrl}\n`;
    }

    res.set('Content-Type', 'application/x-mpegURL');
    res.send(output);
  });

  app.all('/stream/:source/:name', async (req, res) => {
    const { source, name } = req.params;
    const channels = loadChannels();

    const channel = channels.find(
      c => c.source === source && c.name === name
    );

    if (!channel) return res.status(404).send('Channel not found');

    const startTime = Date.now();
    console.info(`[stream] ${source}/${name} -> ${channel.original_url}`);

    if (req.method === 'HEAD') {
      try {
        const response = await axios.head(channel.original_url, { timeout: 5000 });
        res.set(response.headers);
        res.status(response.status || 200).end();
        console.info(`[stream] ${source}/${name} head ok in ${Date.now() - startTime}ms`);
      } catch (err) {
        console.warn(
          `[stream] head failed ${source}/${name}: ${err.message}`,
          {
            status: err.response?.status,
            code: err.code
          }
        );
        res.status(502).end();
      }
      return;
    }

    if (req.method !== 'GET') {
      return res.sendStatus(405);
    }

    let usageKey;
    let usageInterval;
    const registerViewer = async () => {
      if (usageKey) return;
      const channelId = channel.guideNumber || channel.tvg_id || channel.name;
      const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
      usageKey = await registerUsage({ ip: String(ip), channelId: String(channelId) });
      usageInterval = setInterval(() => touchUsage(usageKey), 10000);
      const cleanup = () => {
        if (usageInterval) clearInterval(usageInterval);
        usageInterval = null;
        if (usageKey) unregisterUsage(usageKey);
        usageKey = null;
      };
      res.on('close', cleanup);
      res.on('finish', cleanup);
      res.on('error', cleanup);
    };

    try {
      const response = await axios.get(channel.original_url, {
        responseType: 'stream',
        timeout: 15000
      });

      await registerViewer();

      response.data.on('error', err => {
        console.warn(`[stream] upstream error ${source}/${name}: ${err.message}`);
        res.destroy(err);
      });

      res.set(response.headers);
      response.data.pipe(res);
      console.info(`[stream] ${source}/${name} ready in ${Date.now() - startTime}ms`);
    } catch (err) {
      if (usageKey) unregisterUsage(usageKey);
      if (usageInterval) clearInterval(usageInterval);
      console.warn(
        `[stream] failed ${source}/${name}: ${err.message}`,
        {
          status: err.response?.status,
          code: err.code
        }
      );
      res.status(502).send('Failed to fetch stream');
    }
  });
}
