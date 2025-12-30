import express from 'express';
import fs from 'fs';
import chalk from 'chalk';
import path from 'path';
import { initConfig } from './server/init-config.js';
import { loadAllConfigs } from './libs/config-loader.js';
import { setupHDHRRoutes } from './server/hdhr.js';
import { setupLineupRoutes, invalidateLineupCaches } from './server/lineup.js';
import { setupEPGRoutes } from './server/epg.js';
import { imageProxyRoute } from './libs/proxy-image.js';
import channelsRoute from './server/channels.js';
import configRoute from './server/config.js';
import healthRouter from './server/health.js';
import { parseAll } from './scripts/parseM3U.js';
import usageRouter, { registerUsage, touchUsage, unregisterUsage } from './server/usage.js';
import { initChannelsCache, invalidateCache, onChannelsUpdate } from './libs/channels-cache.js';
import getBaseUrl from './libs/getBaseUrl.js';

// Ensure config files exist before anything else
initConfig();

const app = express();
const port = 34400;

app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
// Use absolute path for static assets to avoid CWD issues
const publicDir = path.resolve('./public');
app.use(express.static(publicDir));
// Serve node_modules to allow ESM imports without a bundler
app.use('/node_modules', express.static(path.resolve('./node_modules')));
// Load and validate config
const configs = loadAllConfigs();

// Try to load vite config, fallback to default if not available
let adminDevPort = 5173;
try {
  const viteConfig = await import('./admin/vite.config.js');
  adminDevPort = viteConfig.default?.server?.port || 5173;
} catch (err) {
  // Vite not installed or config not available, use default
  console.log(chalk.gray('Note: Vite config not loaded (using default port 5173)'));
  if (process.env.DEBUG) {
    console.log(chalk.gray(`  Reason: ${err.message}`));
  }
}

const config = { ...configs.m3u, ...configs.app, host: 'localhost' };

// Admin UI: prefer built Vite output if present, otherwise redirect to dev server
const builtAdminDir = path.join(publicDir, 'admin');
app.get(['/', '/admin', '/admin.html'], (req, res) => {
  const builtIndex = path.join(builtAdminDir, 'index.html');
  if (fs.existsSync(builtIndex)) {
    res.sendFile(builtIndex);
  } else {
    // Redirect to Vite dev server using actual request host
    const baseUrl = getBaseUrl(req);
    const url = new URL(baseUrl);
    url.port = adminDevPort;
    url.pathname = '/admin/';
    res.redirect(url.toString());
  }
});

// Parse channels from M3U sources before server setup
await parseAll();

// Initialize channels cache after parsing
await initChannelsCache();

// Register lineup cache invalidation when channels update
onChannelsUpdate(invalidateLineupCaches);

// Register routes
app.use('/channels', channelsRoute);
app.use(configRoute);
app.use('/', healthRouter);
app.use('/', usageRouter);
imageProxyRoute(app);
setupHDHRRoutes(app, config);
setupLineupRoutes(app, config, { registerUsage, touchUsage, unregisterUsage });
await setupEPGRoutes(app);

// Initialize and start scheduled jobs (health checks, EPG refresh, etc.)
import { initDefaultJobs, startScheduler, schedulerRouter } from './server/scheduler.js';
initDefaultJobs();
app.use('/api/scheduler', schedulerRouter);
await startScheduler();

// Friendly startup banner
app.listen(port, () => {
  const base = `http://${config.host}:${port}`;
  const adminUrl = `http://${config.host}:${adminDevPort}/admin/`;
  console.log(chalk.greenBright(`🚀 IPTV Proxy running at ${chalk.bold(base)}`));
  console.log(chalk.cyan(`  M3U Playlist:`), chalk.yellow(`${base}/lineup.m3u`));
  console.log(chalk.cyan(`  XMLTV Guide:`), chalk.yellow(`${base}/xmltv.xml`));
  console.log(chalk.cyan(`  Admin UI:`), chalk.yellow(adminUrl));
});