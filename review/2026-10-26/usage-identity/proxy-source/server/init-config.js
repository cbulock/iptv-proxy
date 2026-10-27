import fs from 'fs';
import { CONFIG_DIR, getConfigPath } from '../libs/paths.js';

const COMMON_CONFIGS = {
  'app.yaml': `# Application configuration
# Example:
# base_url: https://your-domain.com
{}
`,
  'channel-map.yaml': `# Channel mapping overrides
# Example:
# ChannelName:
#   number: "1.1"
#   tvg_id: "channel.id"
{}
`,
};

const PROVIDERS_CONFIG = `# IPTV Providers configuration
# Each provider combines a channel source (M3U/HDHomeRun) with an optional EPG source.
providers: []
# Example:
#   - name: My IPTV
#     url: http://example.com/playlist.m3u
#     type: m3u
#     epg: http://example.com/epg.xml
#   - name: HDHomeRun
#     url: http://192.168.1.100
#     type: hdhomerun
`;

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

  // Ensure common config files exist
  for (const [filename, defaultContent] of Object.entries(COMMON_CONFIGS)) {
    const filePath = getConfigPath(filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, defaultContent, 'utf8');
      console.log(`Created default config: ${filePath}`);
    }
  }

  // Ensure providers.yaml exists
  if (!fs.existsSync(getConfigPath('providers.yaml'))) {
    fs.writeFileSync(getConfigPath('providers.yaml'), PROVIDERS_CONFIG, 'utf8');
    console.log(`Created default config: ${getConfigPath('providers.yaml')}`);
  }
}

export default initConfig;
