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
import mappingRouter from './server/mapping.js';
import channelsManagementRouter from './server/channels-management.js';
import previewRouter from './server/preview.js';
import cacheRouter from './server/cache.js';
import { parseAll, setStatusCallback } from './scripts/parseM3U.js';
import { updateSourceStatus, resetSourceStatus } from './server/status.js';
import usageRouter, { registerUsage, touchUsage, unregisterUsage } from './server/usage.js';
import { initChannelsCache, invalidateCache, onChannelsUpdate } from './libs/channels-cache.js';
import getBaseUrl from './libs/getBaseUrl.js';
import { notFoundHandler, errorHandler } from './server/error-handler.js';
import { requireAuthHTML } from './server/auth.js';
import authRoutesRouter from './server/auth-routes.js';

// Ensure config files exist before anything else
initConfig();

const app = express();
const port = 34400;

app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// Load and validate config first (needed for auth check)
const configs = loadAllConfigs();

const config = { ...configs.m3u, ...configs.app, host: 'localhost' };

// Admin UI setup (before static middleware to control access)
const publicDir = path.resolve('./public');
const builtAdminDir = path.join(publicDir, 'admin');
const builtAdminIndexPath = path.join(builtAdminDir, 'index.html');
const isAdminBuilt = () => fs.existsSync(builtAdminIndexPath);

// Try to load vite config for dev server info
let adminDevPort = 5173;
try {
  const viteConfig = await import('./admin/vite.config.js');
  adminDevPort = viteConfig.default?.server?.port || 5173;
} catch (err) {
  console.log(chalk.gray('Note: Vite config not loaded (using default port 5173)'));
  if (process.env.DEBUG) {
    console.log(chalk.gray(`  Reason: ${err.message}`));
  }
}

// Rate limiter for admin interface access
const adminLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  skip: (req) => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: (req) => req.ip || 'unknown',
});

// Serve admin assets (JS, CSS, etc.) with authentication
app.use('/admin', adminLimiter, requireAuthHTML, express.static(builtAdminDir));

// Serve admin HTML pages with authentication
app.get(['/', '/admin', '/admin.html'], adminLimiter, requireAuthHTML, (req, res) => {
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

// Serve other static files (not admin)
// Create static middleware once for efficiency
const publicStatic = express.static(publicDir);
app.use((req, res, next) => {
  if (req.path.startsWith('/admin')) {
    return next();
  }
  publicStatic(req, res, next);
});

// Optionally serve node_modules in development to allow ESM imports without a bundler
if (process.env.NODE_ENV === 'development') {
  app.use('/node_modules', express.static(path.resolve('./node_modules')));
}

// Set up source status tracking for parseM3U
setStatusCallback(updateSourceStatus);

// Parse channels from M3U sources before server setup
resetSourceStatus();
await parseAll();

// Initialize channels cache after parsing
await initChannelsCache();

// Register lineup cache invalidation when channels update
onChannelsUpdate(invalidateLineupCaches);

// Register routes
app.use(authRoutesRouter);
app.use('/channels', channelsRoute);
app.use(configRoute);
app.use(mappingRouter);
app.use('/api/channels', channelsManagementRouter);
app.use('/', healthRouter);
app.use('/', statusRouter);
app.use('/', usageRouter);
app.use(previewRouter); // Preview API routes
app.use(cacheRouter); // Cache management routes
imageProxyRoute(app);
setupHDHRRoutes(app, config);
setupLineupRoutes(app, config, { registerUsage, touchUsage, unregisterUsage });
await setupEPGRoutes(app);

// Initialize and start scheduled jobs (health checks, EPG refresh, etc.)
import { initDefaultJobs, startScheduler, schedulerRouter } from './server/scheduler.js';
initDefaultJobs();
app.use('/api/scheduler', schedulerRouter);
await startScheduler();

// Error handling middleware (must be after all routes)
app.use(notFoundHandler);
app.use(errorHandler);

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