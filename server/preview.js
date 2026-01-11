/**
 * Preview API for merged M3U and EPG data
 * Allows users to preview changes before persisting them
 */

import express from 'express';
import fs from 'fs';
import axios from 'axios';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import RateLimit from 'express-rate-limit';
import { validateConfigData } from '../libs/config-loader.js';
import { asyncHandler, AppError } from './error-handler.js';
import getBaseUrl from '../libs/getBaseUrl.js';
import { getProxiedImageUrl } from '../libs/proxy-image.js';

const router = express.Router();

// Rate limiter for preview endpoints
const previewLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 preview requests per window
  message: {
    error: 'Too many preview requests from this IP, please try again later.',
  },
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_"
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true
});

/**
 * Apply channel mapping to a channel object
 */
function applyMapping(channel, map) {
  let mapping = map[channel.name];
  if (!mapping && channel.tvg_id) {
    mapping = map[channel.tvg_id];
  }

  if (mapping) {
    channel.name = mapping.name || channel.name;
    channel.tvg_id = mapping.tvg_id || channel.tvg_id;
    channel.logo = mapping.logo || channel.logo;
    channel.url = mapping.url || channel.url;
    channel.guideNumber = mapping.number || channel.guideNumber;
    channel.group = mapping.group || channel.group;
  }

  if (!channel.tvg_id && channel.guideNumber) {
    channel.tvg_id = channel.guideNumber;
  }

  return channel;
}

/**
 * Parse M3U data from string
 */
function parseM3UData(data, sourceName, channelMap) {
  const channels = [];
  const lines = data.split('\n');
  
  if (lines.length === 0) {
    throw new Error('Empty M3U file');
  }
  
  if (!lines[0].trim().startsWith('#EXTM3U')) {
    console.warn(`Warning: ${sourceName} missing #EXTM3U header`);
  }

  const validProtocols = ['http://', 'https://', 'rtsp://', 'rtp://', 'udp://'];
  let current = {};

  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (!trimmedLine) continue;
    
    if (trimmedLine.startsWith('#EXTINF')) {
      const nameMatch = trimmedLine.match(/,(.*)$/);
      const tvgIdMatch = trimmedLine.match(/tvg-id="(.*?)"/);
      const tvgLogoMatch = trimmedLine.match(/tvg-logo="(.*?)"/);
      const groupMatch = trimmedLine.match(/group-title="(.*?)"/);

      current = {
        name: nameMatch ? nameMatch[1].trim() : 'Unknown',
        tvg_id: tvgIdMatch ? tvgIdMatch[1] : '',
        logo: tvgLogoMatch ? tvgLogoMatch[1] : '',
        group: groupMatch ? groupMatch[1] : sourceName,
        guideNumber: '',
        source: sourceName
      };
    } else if (validProtocols.some(p => trimmedLine.startsWith(p))) {
      if (current.name) {
        current.url = trimmedLine;
        current.original_url = trimmedLine;
        channels.push(applyMapping(current, channelMap));
        current = {};
      }
    }
  }

  return channels;
}

/**
 * Process M3U sources with preview data
 */
async function processM3USources(sources, channelMap) {
  const allChannels = [];

  for (const source of sources) {
    try {
      let data;
      
      if (source.url.startsWith('file://')) {
        const path = source.url.replace('file://', '');
        data = fs.readFileSync(path, 'utf8');
      } else {
        const response = await axios.get(source.url, {
          timeout: 30000,
          maxContentLength: 50 * 1024 * 1024,
          validateStatus: (status) => status === 200
        });
        data = response.data;
      }

      const channels = parseM3UData(data, source.name, channelMap);
      allChannels.push(...channels);
    } catch (err) {
      console.error(`Failed to process source ${source.name}:`, err.message);
      // Continue with other sources
    }
  }

  return allChannels;
}

/**
 * Generate M3U playlist from channels
 */
function generateM3U(channels, baseUrl) {
  let m3u = '#EXTM3U\n';
  
  for (const channel of channels) {
    const tvgId = channel.tvg_id || '';
    const tvgLogo = channel.logo || '';
    const group = channel.group || channel.source || '';
    const guideNumber = channel.guideNumber || '';
    
    m3u += `#EXTINF:-1 tvg-id="${tvgId}" tvg-logo="${tvgLogo}" group-title="${group}"`;
    if (guideNumber) {
      m3u += ` tvg-chno="${guideNumber}"`;
    }
    m3u += `,${channel.name}\n`;
    
    const streamUrl = `${baseUrl}/stream/${encodeURIComponent(channel.source || 'unknown')}/${encodeURIComponent(channel.name)}`;
    m3u += `${streamUrl}\n`;
  }
  
  return m3u;
}

/**
 * Preview merged M3U with temporary configuration
 */
router.post('/api/preview/m3u', previewLimiter, asyncHandler(async (req, res) => {
  const { m3uConfig, channelMapConfig } = req.body;
  
  // Validate configs
  if (!m3uConfig) {
    throw new AppError('Missing m3uConfig in request body', 400);
  }
  
  const m3uValidation = validateConfigData('m3u', m3uConfig);
  if (!m3uValidation.valid) {
    throw new AppError(`Invalid M3U config: ${m3uValidation.error}`, 400);
  }
  
  const channelMap = channelMapConfig || {};
  const channelMapValidation = validateConfigData('channelMap', channelMap);
  if (!channelMapValidation.valid) {
    throw new AppError(`Invalid channel map: ${channelMapValidation.error}`, 400);
  }
  
  // Process sources
  const sources = m3uValidation.value.urls || [];
  const channels = await processM3USources(sources, channelMapValidation.value);
  
  const baseUrl = getBaseUrl(req);
  const m3uContent = generateM3U(channels, baseUrl);
  
  res.set('Content-Type', 'application/x-mpegURL');
  res.send(m3uContent);
}));

/**
 * Preview merged M3U as JSON
 */
router.post('/api/preview/channels', previewLimiter, asyncHandler(async (req, res) => {
  const { m3uConfig, channelMapConfig } = req.body;
  
  // Validate configs
  if (!m3uConfig) {
    throw new AppError('Missing m3uConfig in request body', 400);
  }
  
  const m3uValidation = validateConfigData('m3u', m3uConfig);
  if (!m3uValidation.valid) {
    throw new AppError(`Invalid M3U config: ${m3uValidation.error}`, 400);
  }
  
  const channelMap = channelMapConfig || {};
  const channelMapValidation = validateConfigData('channelMap', channelMap);
  if (!channelMapValidation.valid) {
    throw new AppError(`Invalid channel map: ${channelMapValidation.error}`, 400);
  }
  
  // Process sources
  const sources = m3uValidation.value.urls || [];
  const channels = await processM3USources(sources, channelMapValidation.value);
  
  res.json({
    channels,
    count: channels.length,
    sources: sources.map(s => s.name)
  });
}));

/**
 * Preview merged EPG with temporary configuration
 */
router.post('/api/preview/epg', previewLimiter, asyncHandler(async (req, res) => {
  const { epgConfig, channels } = req.body;
  
  // Validate EPG config
  if (!epgConfig) {
    throw new AppError('Missing epgConfig in request body', 400);
  }
  
  const epgValidation = validateConfigData('epg', epgConfig);
  if (!epgValidation.valid) {
    throw new AppError(`Invalid EPG config: ${epgValidation.error}`, 400);
  }
  
  // Use provided channels or empty array
  const channelList = channels || [];
  
  const merged = { tv: { channel: [], programme: [] } };
  const epgSources = epgValidation.value.urls || [];
  
  for (const source of epgSources) {
    const sourceName = source.name;
    const sourceUrl = source.url;
    
    // Build filter sets
    const sourceChannels = channelList.filter(c => c.source === sourceName);
    const tvgIds = new Set();
    const names = new Set();
    for (const ch of sourceChannels) {
      if (ch.tvg_id) tvgIds.add(ch.tvg_id);
      names.add(ch.name);
    }
    
    try {
      let xmlData;
      
      if (sourceUrl.startsWith('file://')) {
        const path = sourceUrl.replace('file://', '');
        xmlData = fs.readFileSync(path, 'utf-8');
      } else {
        const response = await axios.get(sourceUrl, {
          timeout: 15000,
          validateStatus: (status) => status === 200
        });
        xmlData = response.data;
      }
      
      if (!xmlData || typeof xmlData !== 'string' || xmlData.trim().length === 0) {
        throw new Error('Empty or invalid EPG data received');
      }
      
      const parsed = parser.parse(xmlData);
      
      if (!parsed || !parsed.tv) {
        throw new Error('Invalid XMLTV structure');
      }
      
      if (parsed.tv?.channel) {
        const channels = [].concat(parsed.tv.channel).filter(c =>
          c && (tvgIds.has(c["@_id"]) || names.has(c["display-name"]))
        );
        merged.tv.channel.push(...channels);
      }
      
      if (parsed.tv?.programme) {
        const programmes = [].concat(parsed.tv.programme).filter(p =>
          p && (tvgIds.has(p["@_channel"]) || names.has(p["@_channel"]))
        );
        merged.tv.programme.push(...programmes);
      }
    } catch (err) {
      console.error(`Failed to load EPG from ${sourceName}:`, err.message);
      // Continue with other sources
    }
  }
  
  const xmlContent = builder.build(merged);
  
  res.set('Content-Type', 'application/xml');
  res.send(xmlContent);
}));

/**
 * Preview merged EPG as JSON
 */
router.post('/api/preview/epg/json', previewLimiter, asyncHandler(async (req, res) => {
  const { epgConfig, channels } = req.body;
  
  // Validate EPG config
  if (!epgConfig) {
    throw new AppError('Missing epgConfig in request body', 400);
  }
  
  const epgValidation = validateConfigData('epg', epgConfig);
  if (!epgValidation.valid) {
    throw new AppError(`Invalid EPG config: ${epgValidation.error}`, 400);
  }
  
  // Use provided channels or empty array
  const channelList = channels || [];
  
  const merged = { tv: { channel: [], programme: [] } };
  const epgSources = epgValidation.value.urls || [];
  
  for (const source of epgSources) {
    const sourceName = source.name;
    const sourceUrl = source.url;
    
    // Build filter sets
    const sourceChannels = channelList.filter(c => c.source === sourceName);
    const tvgIds = new Set();
    const names = new Set();
    for (const ch of sourceChannels) {
      if (ch.tvg_id) tvgIds.add(ch.tvg_id);
      names.add(ch.name);
    }
    
    try {
      let xmlData;
      
      if (sourceUrl.startsWith('file://')) {
        const path = sourceUrl.replace('file://', '');
        xmlData = fs.readFileSync(path, 'utf-8');
      } else {
        const response = await axios.get(sourceUrl, {
          timeout: 15000,
          validateStatus: (status) => status === 200
        });
        xmlData = response.data;
      }
      
      if (!xmlData || typeof xmlData !== 'string' || xmlData.trim().length === 0) {
        throw new Error('Empty or invalid EPG data received');
      }
      
      const parsed = parser.parse(xmlData);
      
      if (!parsed || !parsed.tv) {
        throw new Error('Invalid XMLTV structure');
      }
      
      if (parsed.tv?.channel) {
        const channels = [].concat(parsed.tv.channel).filter(c =>
          c && (tvgIds.has(c["@_id"]) || names.has(c["display-name"]))
        );
        merged.tv.channel.push(...channels);
      }
      
      if (parsed.tv?.programme) {
        const programmes = [].concat(parsed.tv.programme).filter(p =>
          p && (tvgIds.has(p["@_channel"]) || names.has(p["@_channel"]))
        );
        merged.tv.programme.push(...programmes);
      }
    } catch (err) {
      console.error(`Failed to load EPG from ${sourceName}:`, err.message);
      // Continue with other sources
    }
  }
  
  res.json({
    channels: merged.tv.channel.length,
    programmes: merged.tv.programme.length,
    sources: epgSources.map(s => s.name),
    data: merged
  });
}));

export default router;
