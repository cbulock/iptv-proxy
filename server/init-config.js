import fs from 'fs';
import path from 'path';
import { CONFIG_DIR, getConfigPath } from '../libs/paths.js';

const DEFAULT_CONFIGS = {
  'app.yaml': `# Application configuration
# Example:
# base_url: https://your-domain.com
{}
`,
  'm3u.yaml': `# M3U playlist sources
urls: []
# Example:
#   - name: My IPTV
#     url: http://example.com/playlist.m3u
#     type: m3u
#   - name: HDHomeRun
#     url: http://192.168.1.100
#     type: hdhomerun
`,
  'epg.yaml': `# EPG (XMLTV) sources
urls: []
# Example:
#   - name: My EPG
#     url: http://example.com/epg.xml
`,
  'channel-map.yaml': `# Channel mapping overrides
# Example:
# ChannelName:
#   number: "1.1"
#   tvg_id: "channel.id"
{}
`,
};

/**
 * Ensures the config directory and all required config files exist.
 * Creates them with default content if missing.
 */
export function initConfig() {
  // Ensure config directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    console.log(`Created config directory: ${CONFIG_DIR}`);
  }

  // Ensure each config file exists
  for (const [filename, defaultContent] of Object.entries(DEFAULT_CONFIGS)) {
    const filePath = getConfigPath(filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, defaultContent, 'utf8');
      console.log(`Created default config: ${filePath}`);
    }
  }
}

export default initConfig;
