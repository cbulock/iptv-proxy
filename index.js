import express from 'express';
import fs from 'fs';
import yaml from 'yaml';
import { setupHDHRRoutes } from './server/hdhr.js';
import { setupLineupRoutes } from './server/lineup.js';
import { setupEPGRoutes } from './server/epg.js';

const app = express();
const port = 34400;

// Load config
const m3uConfig = yaml.parse(fs.readFileSync('./config/m3u.yaml', 'utf8'));
const config = { ...m3uConfig, host: 'localhost' };

// Register routes
setupHDHRRoutes(app, config);
setupLineupRoutes(app, config);
await setupEPGRoutes(app);

app.listen(port, () => {
  console.log(`IPTV Proxy running at http://localhost:${port}`);
});
