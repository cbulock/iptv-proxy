import express from 'express';
import fs from 'fs';
import yaml from 'yaml';
import chalk from 'chalk';
import path from 'path';
import { setupHDHRRoutes } from './server/hdhr.js';
import { setupLineupRoutes } from './server/lineup.js';
import { setupEPGRoutes } from './server/epg.js';
import { imageProxyRoute } from './libs/proxy-image.js';
import channelsRoute from './server/channels.js';
import configRoute from './server/config.js';
import healthRouter from './server/health.js';
import { parseAll } from './scripts/parseM3U.js';
import usageRouter, { registerUsage, touchUsage, unregisterUsage } from './server/usage.js';

const app = express();
const port = 34400;

app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
// Use absolute path for static assets to avoid CWD issues
const publicDir = path.resolve('./public');
app.use(express.static(publicDir));
// Serve node_modules to allow ESM imports without a bundler
app.use('/node_modules', express.static(path.resolve('./node_modules')));
// Admin UI: prefer built Vite output if present
const builtAdminDir = path.join(publicDir, 'admin');
app.get(['/admin','/admin.html'], (req, res) => {
  const target = fs.existsSync(path.join(builtAdminDir, 'index.html'))
    ? path.join(builtAdminDir, 'index.html')
    : path.join(publicDir, 'index.html');
  res.sendFile(target);
});

// Parse channels from M3U sources before server setup
await parseAll();

// Load config
const m3uConfig = yaml.parse(fs.readFileSync('./config/m3u.yaml', 'utf8'));
const config = { ...m3uConfig, host: 'localhost' };

// Register routes
app.use('/channels', channelsRoute);
app.use(configRoute);
app.use('/', healthRouter);
app.use('/', usageRouter);
imageProxyRoute(app);
setupHDHRRoutes(app, config);
setupLineupRoutes(app, config);
await setupEPGRoutes(app);

// Minimal usage tracking around stream requests
app.use(async (req, res, next) => {
  if (req.path.startsWith('/stream/')) {
    const channelId = req.params?.channelId || req.path.split('/').pop();
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const key = await registerUsage({ ip: String(ip), channelId: String(channelId) });
    // keep lastSeen fresh on data write/finish
    const interval = setInterval(() => touchUsage(key), 10000);
    res.on('close', () => { clearInterval(interval); unregisterUsage(key); });
    res.on('finish', () => { clearInterval(interval); unregisterUsage(key); });
  }
  next();
});

// Start cron job for channel health checks
import './scripts/scheduler.js';

// Friendly startup banner
app.listen(port, () => {
  const base = `http://${config.host}:${port}`;
  console.log(chalk.greenBright(`🚀 IPTV Proxy running at ${chalk.bold(base)}`));
  console.log(chalk.cyan(`  M3U Playlist:`), chalk.yellow(`${base}/lineup.m3u`));
  console.log(chalk.cyan(`  XMLTV Guide:`), chalk.yellow(`${base}/xmltv.xml`));
  console.log(chalk.cyan(`  Admin UI:`), chalk.yellow(`${base}/admin`));
});