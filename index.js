import express from 'express';
import fs from 'fs';
import yaml from 'yaml';
import chalk from 'chalk';
import { setupHDHRRoutes } from './server/hdhr.js';
import { setupLineupRoutes } from './server/lineup.js';
import { setupEPGRoutes } from './server/epg.js';
import { parseAll } from './scripts/parseM3U.js';

const app = express();
const port = 34400;

// Parse channels from M3U sources before server setup
await parseAll();

// Load config
const m3uConfig = yaml.parse(fs.readFileSync('./config/m3u.yaml', 'utf8'));
const config = { ...m3uConfig, host: 'localhost' };

// Register routes
setupHDHRRoutes(app, config);
setupLineupRoutes(app, config);
await setupEPGRoutes(app);

// Friendly startup banner
app.listen(port, () => {
  const base = `http://${config.host}:${port}`;
  console.log(chalk.greenBright(`🚀 IPTV Proxy running at ${chalk.bold(base)}`));
  console.log(chalk.cyan(`  M3U Playlist:`), chalk.yellow(`${base}/playlist.m3u`));
  console.log(chalk.cyan(`  XMLTV Guide:`), chalk.yellow(`${base}/xmltv.xml`));
});