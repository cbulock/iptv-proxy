// Test helper utilities
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const FIXTURES_DIR = join(__dirname, 'fixtures');

/**
 * Load a test fixture file
 * @param {string} filename - The fixture filename
 * @returns {Promise<string>} The file contents
 */
export async function loadFixture(filename) {
  const filePath = join(FIXTURES_DIR, filename);
  return await fs.readFile(filePath, 'utf8');
}

/**
 * Create a mock M3U source configuration
 */
export function createMockM3USource(name = 'TestSource', url = 'http://test.example.com/playlist.m3u') {
  return {
    name,
    url,
  };
}

/**
 * Create a mock channel object
 */
export function createMockChannel(overrides = {}) {
  return {
    name: 'Test Channel',
    tvg_id: 'test.1',
    logo: 'http://example.com/logo.png',
    url: '/stream/TestSource/Test%20Channel',
    original_url: 'http://test.example.com/stream1',
    guideNumber: '1',
    source: 'TestSource',
    ...overrides,
  };
}

/**
 * Create a mock channel mapping
 */
export function createMockMapping(channelName, overrides = {}) {
  return {
    [channelName]: {
      name: channelName,
      tvg_id: 'mapped.1',
      logo: 'http://example.com/mapped-logo.png',
      number: '100',
      group: 'Entertainment',
      ...overrides,
    },
  };
}

/**
 * Generate a valid M3U playlist string
 */
export function generateM3UPlaylist(channels = []) {
  let m3u = '#EXTM3U\n';
  
  for (const channel of channels) {
    const tvgId = channel.tvg_id ? `tvg-id="${channel.tvg_id}" ` : '';
    const tvgLogo = channel.logo ? `tvg-logo="${channel.logo}" ` : '';
    m3u += `#EXTINF:-1 ${tvgId}${tvgLogo}${channel.group ? `group-title="${channel.group}" ` : ''},${channel.name}\n`;
    m3u += `${channel.url}\n`;
  }
  
  return m3u;
}

/**
 * Generate a valid XMLTV EPG string
 */
export function generateXMLTV(channels = [], programmes = []) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n';
  
  for (const channel of channels) {
    xml += `  <channel id="${channel.id}">\n`;
    xml += `    <display-name>${channel.name}</display-name>\n`;
    if (channel.icon) {
      xml += `    <icon src="${channel.icon}" />\n`;
    }
    xml += `  </channel>\n`;
  }
  
  for (const programme of programmes) {
    xml += `  <programme channel="${programme.channel}" start="${programme.start}" stop="${programme.stop}">\n`;
    xml += `    <title>${programme.title}</title>\n`;
    if (programme.desc) {
      xml += `    <desc>${programme.desc}</desc>\n`;
    }
    xml += `  </programme>\n`;
  }
  
  xml += '</tv>\n';
  return xml;
}
