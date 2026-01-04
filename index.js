import express from 'express';
import fs from 'fs';
import chalk from 'chalk';
import path from 'path';
import RateLimit from 'express-rate-limit';
import { initConfig } from './server/init-config.js';
import { loadAllConfigs } from './libs/config-loader.js';
import { setupHDHRRoutes } from './server/hdhr.js';
import { setupLineupRoutes, invalidateLineupCaches } from './server/lineup.js';
import { setupEPGRoutes } from './server/epg.js';
import { imageProxyRoute } from './libs/proxy-image.js';
import channelsRoute from './server/channels.js';
import configRoute from './server/config.js';
import healthRouter from './server/health.js';
import statusRouter from './server/status.js';
import { parseAll, setStatusCallback } from './scripts/parseM3U.js';
import { updateSourceStatus, resetSourceStatus } from './server/status.js';
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
// Optionally serve node_modules in development to allow ESM imports without a bundler
if (process.env.NODE_ENV === 'development') {
  app.use('/node_modules', express.static(path.resolve('./node_modules')));
}
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

// Set up source status tracking for parseM3U
setStatusCallback(updateSourceStatus);

// Admin UI: serve built Vite output if present, otherwise show error
const builtAdminDir = path.join(publicDir, 'admin');
const builtAdminIndexPath = path.join(builtAdminDir, 'index.html');
const isAdminBuilt = () => fs.existsSync(builtAdminIndexPath);

// Rate limiter for admin interface access
const adminLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.get(['/', '/admin', '/admin.html'], adminLimiter, (req, res) => {
  if (isAdminBuilt()) {
    res.sendFile(builtAdminIndexPath);
  } else {
    // Admin UI not built - show helpful error message
    res.status(503).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Admin UI Not Available</title>
          <style>
            body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            h1 { color: #e74c3c; }
            code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
            pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
          </style>
        </head>
        <body>
          <h1>Admin UI Not Available</h1>
          <p>The admin interface has not been built. To use the admin UI, you need to build it first.</p>
          <h2>Build Instructions:</h2>
          <pre>cd admin
npm install
npm run build</pre>
          <p>Or use the shortcut from the project root:</p>
          <pre>npm run admin:build</pre>
          <p>For development with hot reload, run:</p>
          <pre>npm run dev</pre>
          <p>This will start both the server and the admin dev server on port ${adminDevPort}.</p>
        </body>
      </html>
    `);
  }
});

// Parse channels from M3U sources before server setup
resetSourceStatus();
await parseAll();

// Initialize channels cache after parsing
await initChannelsCache();

// Register lineup cache invalidation when channels update
onChannelsUpdate(invalidateLineupCaches);

// Register routes
app.use('/channels', channelsRoute);
app.use(configRoute);
app.use('/', healthRouter);
app.use('/', statusRouter);
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
  const adminUrl = isAdminBuilt()
    ? `${base}/admin/`
    : `http://${config.host}:${adminDevPort}/admin/ (dev server - run 'npm run dev')`;
  
  console.log(chalk.greenBright(`🚀 IPTV Proxy running at ${chalk.bold(base)}`));
  console.log(chalk.cyan(`  M3U Playlist:`), chalk.yellow(`${base}/lineup.m3u`));
  console.log(chalk.cyan(`  XMLTV Guide:`), chalk.yellow(`${base}/xmltv.xml`));
  console.log(chalk.cyan(`  Admin UI:`), chalk.yellow(adminUrl));
});