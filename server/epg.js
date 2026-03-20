import fs from 'fs';
import axios from 'axios';
import RateLimit from 'express-rate-limit';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import escapeHtml from 'escape-html';
import { loadConfig } from '../libs/config-loader.js';
import { getChannels } from '../libs/channels-cache.js';
import { asyncHandler, AppError } from './error-handler.js';
import { validateEPGCoverage } from '../libs/epg-validator.js';
import cacheManager from '../libs/cache-manager.js';
import { requireAuth } from './auth.js';

import { getProxiedImageUrl } from '../libs/proxy-image.js';

// Rate limiter for the public XMLTV endpoint
const epgLimiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  skip: (req) => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: (req) => req.ip || 'unknown',
});

// Module-level refresher that will be set when routes are initialized
let refreshImpl = null;
export async function refreshEPG() {
  if (typeof refreshImpl === 'function') {
    await refreshImpl();
  } else {
    throw new Error('EPG refresher not initialized');
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
});
const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true
});

// EPG cache (replaces rewrittenXMLCache)
let epgCache = null;

// Module-level merged EPG XML string (set by setupEPGRoutes)
let mergedEPG = null;

// Maximum number of programmes returned per guide query (matches /api/guide behaviour)
const MAX_GUIDE_PROGRAMMES = 20;

/**
 * Extract a plain string from an XMLTV text field which may be a raw string,
 * a fast-xml-parser object `{ '#text': '...', '@_lang': '...' }`, an array
 * of such values, or null/undefined.
 * @param {*} raw
 * @returns {string}
 */
export function extractTextField(raw) {
  if (raw == null) return '';
  // fast-xml-parser can produce arrays for repeated elements (e.g. multiple <title> tags)
  if (Array.isArray(raw)) {
    if (raw.length === 0) return '';
    return extractTextField(raw[0]);
  }
  if (typeof raw === 'object') {
    // Typical shape: { '#text': 'Title', '@_lang': 'en' }
    if (Object.prototype.hasOwnProperty.call(raw, '#text')) {
      const value = raw['#text'];
      return value == null ? '' : String(value);
    }
    // Avoid String(raw) => "[object Object]" when there is no text content
    return '';
  }
  return String(raw);
}

/**
 * Parse an XMLTV date string (e.g. "20240115143000 +0000") into a JS Date.
 * Returns null when the string cannot be parsed.
 * @param {string|number} str
 * @returns {Date|null}
 */
export function parseXMLTVDate(str) {
  if (!str) return null;
  const match = String(str).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!match) return null;
  const [, year, month, day, hour, min, sec, tz] = match;
  let tzOffset = 0;
  if (tz) {
    const sign = tz[0] === '+' ? 1 : -1;
    const tzH = parseInt(tz.slice(1, 3), 10);
    const tzM = parseInt(tz.slice(3, 5), 10);
    tzOffset = sign * (tzH * 60 + tzM) * 60 * 1000;
  }
  const utc = Date.UTC(+year, +month - 1, +day, +hour, +min, +sec);
  return new Date(utc - tzOffset);
}

function rewriteImageUrls(xmlString, req) {
  const protocol = req.get('X-Forwarded-Proto') ||
        req.get('X-Forwarded-Protocol') ||
        req.get('X-Url-Scheme') ||
        (req.get('X-Forwarded-Ssl') === 'on' ? 'https' : req.protocol);
    
  // Check cache - include filter params in cache key
  const filterSource = req.query.source || '';
  const filterChannels = req.query.channels || '';
  const cacheKey = `${protocol}://${req.get('host')}|source:${filterSource}|channels:${filterChannels}`;
  if (epgCache && epgCache.has(cacheKey)) {
    return epgCache.get(cacheKey);
  }
    
  const parsed = parser.parse(xmlString);

  const rewrite = (node, sourceName) => {
    if (node.icon?.['@_src']?.startsWith('http')) {
      node.icon['@_src'] = getProxiedImageUrl(node.icon['@_src'], sourceName, req);
    }
  };

  const tv = parsed.tv;
  for (const channel of [].concat(tv.channel || [])) {
    rewrite(channel, channel['display-name'] || 'unknown');
  }
  for (const prog of [].concat(tv.programme || [])) {
    rewrite(prog, prog['@_channel'] || 'unknown');
  }

  const result = builder.build(parsed);
    
  // Cache the result
  if (epgCache) {
    epgCache.set(cacheKey, result);
  }
    
  return result;
}

/**
 * Return EPG guide programmes for a specific channel (or all channels).
 * Mirrors the logic of the /api/guide endpoint.
 *
 * @param {string|null} tvgId  - TVG ID to filter by, or null for all channels.
 * @param {number} [hours=24] - How many hours ahead to include (max 48).
 * @returns {{ programmes: Array, total: number }|null} null when EPG is not loaded yet.
 */
export function getGuideData(tvgId, hours = 24) {
  if (!mergedEPG) return null;

  const clampedHours = Math.min(48, Math.max(1, hours));
  const parsed = parser.parse(mergedEPG);
  const now = Date.now();
  const cutoff = now + clampedHours * 60 * 60 * 1000;

  let programmes = [].concat(parsed.tv?.programme || []);

  if (tvgId) {
    programmes = programmes.filter(p => p && p['@_channel'] === tvgId);
  }

  programmes = programmes.filter(p => {
    const start = parseXMLTVDate(p['@_start']);
    const stop = p['@_stop'] ? parseXMLTVDate(p['@_stop']) : null;
    if (!start) return false;
    const startMs = start.getTime();
    const stopMs = stop ? stop.getTime() : startMs + 30 * 60 * 1000;
    p._startMs = startMs;
    return stopMs > now - 60 * 1000 && startMs < cutoff;
  });

  programmes.sort((a, b) => (a._startMs || 0) - (b._startMs || 0));
  programmes = programmes.slice(0, MAX_GUIDE_PROGRAMMES);

  const result = programmes.map(p => ({
    title: extractTextField(p.title),
    desc: extractTextField(p.desc),
    start: p['@_start'] || '',
    stop: p['@_stop'] || '',
    channel: p['@_channel'] || '',
  }));

  return { programmes: result, total: result.length };
}

/**
 * Reset the in-memory merged EPG data.
 * Intended for use in tests only.
 * @internal
 */
export function _resetMergedEPGForTesting() {
  mergedEPG = null;
}

export async function setupEPGRoutes(app) {
  const appConfig = loadConfig('app');

  function loadEPGSources() {
    const providersConfig = loadConfig('providers');
    return (providersConfig.providers || [])
      .filter(p => p.epg)
      .map(p => ({ name: p.name, url: p.epg }));
  }

  // Initialize EPG cache with TTL from config (default: 6 hours)
  const epgTTL = (appConfig.cache?.epg_ttl ?? 21600) * 1000; // Convert seconds to milliseconds
  epgCache = cacheManager.createCache('epg', epgTTL);
  console.log(`EPG cache initialized with TTL: ${epgTTL / 1000}s`);

  async function fetchAndMergeEPGs() {
    const startTime = Date.now();
    const allChannels = getChannels();
    const merged = { tv: { channel: [], programme: [] } };
    const epgSources = loadEPGSources();

    for (const source of epgSources) {
      const sourceName = source.name;
      const sourceUrl = source.url;

      const sourceChannels = allChannels.filter(c => c.source === sourceName);
            
      // Build both Sets in a single pass for better performance
      const tvgIds = new Set();
      const names = new Set();
      for (const ch of sourceChannels) {
        if (ch.tvg_id) tvgIds.add(ch.tvg_id);
        names.add(ch.name);
      }

      try {
        console.log(`Loading EPG: ${sourceName} (${sourceUrl})`);

        let xmlData;

        if (sourceUrl.startsWith('file://')) {
          const path = sourceUrl.replace('file://', '');
          try {
            xmlData = fs.readFileSync(path, 'utf-8');
          } catch (fileErr) {
            throw new Error(`Failed to read file: ${fileErr.message}`);
          }
        } else {
          try {
            const response = await axios.get(sourceUrl, { 
              timeout: 15000,
              validateStatus: (status) => status === 200
            });
            xmlData = response.data;
          } catch (httpErr) {
            throw new Error(`Failed to fetch EPG: ${httpErr.message}`);
          }
        }

        // Validate that we got XML data
        if (!xmlData || typeof xmlData !== 'string' || xmlData.trim().length === 0) {
          throw new Error('Empty or invalid EPG data received');
        }

        // Validate basic XML structure (allow whitespace/comments before declaration)
        const trimmedXml = xmlData.trim();
        if (!trimmedXml.includes('<?xml') && !trimmedXml.includes('<tv')) {
          throw new Error('Invalid XML format - missing XML declaration or root element');
        }

        let parsed;
        try {
          parsed = parser.parse(xmlData);
        } catch (parseErr) {
          throw new Error(`XML parsing failed: ${parseErr.message}`);
        }

        // Validate parsed structure
        if (!parsed || !parsed.tv) {
          throw new Error('Invalid XMLTV structure - missing <tv> root element');
        }

        if (parsed.tv?.channel) {
          const channels = [].concat(parsed.tv.channel).filter(c =>
            c && (tvgIds.has(c['@_id']) || names.has(c['display-name']))
          );

          merged.tv.channel.push(...channels);
        }

        if (parsed.tv?.programme) {
          const programmes = [].concat(parsed.tv.programme).filter(p =>
            p && (tvgIds.has(p['@_channel']) || names.has(p['@_channel']))
          );

          merged.tv.programme.push(...programmes);
        }
                
        console.log(`Loaded ${merged.tv.programme.length} programmes from ${sourceName}`);
      } catch (err) {
        console.error(`❌ Failed to load EPG from ${sourceName}: ${err.message}`);
                
        // Provide actionable error messages
        if (sourceUrl.startsWith('file://')) {
          const path = sourceUrl.replace('file://', '');
          console.log('   💡 Fix: Local file error');
          console.log(`      • Verify the file exists at: ${path}`);
          console.log('      • Check file permissions (must be readable)');
          console.log('      • Ensure the path is correct (relative to project root)');
        } else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
          console.log('   💡 Fix: DNS resolution failed');
          console.log(`      • Check the hostname in the URL: ${sourceUrl}`);
          console.log('      • Try using an IP address instead');
          console.log('      • Verify DNS server settings');
        } else if (err.code === 'ECONNREFUSED') {
          console.log('   💡 Fix: Connection refused');
          console.log('      • Verify the EPG service is running');
          console.log('      • Check the port number is correct');
          console.log('      • Ensure firewall allows the connection');
        } else if (err.code === 'ETIMEDOUT') {
          console.log('   💡 Fix: Connection timed out');
          console.log('      • The EPG source is taking too long to respond');
          console.log('      • Check network connectivity');
          console.log('      • Try again later if server is overloaded');
        } else if (err.response?.status === 404) {
          console.log('   💡 Fix: EPG file not found (404)');
          console.log(`      • Verify the URL is correct: ${sourceUrl}`);
          console.log('      • Check that the EPG endpoint exists');
        } else if (err.response?.status === 401 || err.response?.status === 403) {
          console.log(`   💡 Fix: Authentication failed (${err.response.status})`);
          console.log('      • Check credentials in the URL if required');
          console.log('      • Ensure proper URL encoding of username/password');
        } else if (err.response?.status >= 400 && err.response?.status < 500) {
          console.log(`   💡 Fix: Client error (${err.response.status})`);
          console.log('      • The request was invalid or rejected by the server');
          console.log('      • Check the URL and request parameters');
          console.log('      • Review server documentation for this endpoint');
        } else if (err.message?.includes('parse') || err.message?.includes('XML')) {
          console.log('   💡 Fix: Invalid XMLTV format');
          console.log('      • Verify the source provides valid XMLTV/XML data');
          console.log(`      • Test the URL manually: curl "${sourceUrl}" | head`);
          console.log('      • Validate XML at: https://www.xmlvalidation.com/');
        } else {
          console.log('   💡 Fix: Check EPG source accessibility');
          console.log(`      • Test manually: curl -I "${sourceUrl}"`);
          console.log('      • See README.md troubleshooting section');
        }
      }
    }

    try {
      mergedEPG = builder.build(merged);
    } catch (buildErr) {
      console.error('Failed to build merged EPG XML:', buildErr.message);
      // Keep the old EPG if build fails
      if (!mergedEPG) {
        mergedEPG = '<?xml version="1.0" encoding="UTF-8"?>\n<tv></tv>';
      }
    }
        
    // Clear EPG cache when EPG is refreshed
    if (epgCache) {
      epgCache.clear();
    }
        
    const duration = Date.now() - startTime;
    console.log(`EPG merge completed in ${duration}ms (${merged.tv.channel.length} channels, ${merged.tv.programme.length} programmes)`);
  }

  // Expose refresher
  refreshImpl = fetchAndMergeEPGs;

  await fetchAndMergeEPGs();
  // unref() so the interval does not prevent the process from exiting cleanly
  setInterval(fetchAndMergeEPGs, 6 * 60 * 60 * 1000).unref();

  app.get('/xmltv.xml', epgLimiter, asyncHandler(async (req, res) => {
    if (!mergedEPG) {
      throw new AppError('EPG not loaded yet', 503);
    }

    // Extract query parameters for filtering
    const filterSource = req.query.source ? String(req.query.source) : null;
    const filterChannels = req.query.channels ? String(req.query.channels).split(',') : null;
        
    let xmlToSend = mergedEPG;
        
    // Apply filters if specified
    if ((filterSource || filterChannels) && typeof mergedEPG === 'string' && mergedEPG.trim()) {
      try {
        const parsed = parser.parse(mergedEPG);
                
        if (!parsed || !parsed.tv) {
          throw new Error('Invalid EPG structure');
        }
                
        const allChannels = getChannels();
                
        // Build set of allowed tvg_ids based on filters
        const allowedTvgIds = new Set();
                
        if (filterSource) {
          // Filter by source
          const sourceChannels = allChannels.filter(c => c && c.source === filterSource);
          sourceChannels.forEach(c => {
            if (c.tvg_id) allowedTvgIds.add(c.tvg_id);
          });
        } else if (filterChannels) {
          // Filter by specific channel IDs
          filterChannels.forEach(id => allowedTvgIds.add(id.trim()));
        }
                
        // Filter channels and programmes
        if (allowedTvgIds.size > 0 && parsed.tv) {
          const tv = parsed.tv;
          tv.channel = [].concat(tv.channel || []).filter(c =>
            c && allowedTvgIds.has(c['@_id'])
          );
          tv.programme = [].concat(tv.programme || []).filter(p =>
            p && allowedTvgIds.has(p['@_channel'])
          );
                    
          xmlToSend = builder.build(parsed);
        }
      } catch (filterErr) {
        console.error('[EPG] Error filtering XMLTV:', filterErr.message);
        // Fall back to unfiltered XML
      }
    }

    const rewritten = rewriteImageUrls(xmlToSend, req);

    res.set('Content-Type', 'application/xml');
    res.send(rewritten);
  }));

  app.get('/images/:source/:url', asyncHandler(async (req, res) => {
    const decodedUrl = decodeURIComponent(req.params.url);
        
    // Validate URL format
    if (!decodedUrl.startsWith('http://') && !decodedUrl.startsWith('https://')) {
      throw new AppError('Invalid image URL', 400, 'URL must start with http:// or https://');
    }
        
    try {
      const response = await axios.get(decodedUrl, { 
        responseType: 'stream',
        timeout: 10000,
        maxRedirects: 5
      });
      res.set(response.headers);
      response.data.pipe(res);
    } catch (err) {
      const statusCode = err.response?.status || 502;
      throw new AppError(
        'Failed to fetch image',
        statusCode,
        `Could not retrieve image from ${escapeHtml(decodedUrl)}`
      );
    }
  }));

  // New endpoint: validate current merged EPG
  app.get('/api/epg/validate', (req, res) => {
    if (!mergedEPG) {
      return res.status(503).json({ error: 'EPG not loaded yet' });
    }

    try {
      const channels = getChannels();
      const validation = validateEPGCoverage(mergedEPG, channels);
            
      res.json({
        valid: validation.valid,
        summary: {
          channels: validation.channelCount,
          programmes: validation.programmeCount,
          validChannels: validation.validChannels,
          validProgrammes: validation.validProgrammes,
          errorCount: validation.errors.length,
          warningCount: validation.warnings.length
        },
        coverage: validation.coverage || null,
        errors: validation.errors,
        warnings: validation.warnings,
        details: validation.details
      });
    } catch (err) {
      res.status(500).json({ error: 'Validation failed', detail: err.message });
    }
  });

  /**
   * Guide data endpoint — returns current and upcoming programmes for a channel.
   * Query params:
   *   tvgId  — the tvg-id / XMLTV channel id to filter by (optional; omit to return all channels)
   *   hours  — how many hours ahead to return (default 24, max 48)
   */
  app.get('/api/guide', requireAuth, epgLimiter, asyncHandler(async (req, res) => {
    if (!mergedEPG) {
      return res.status(503).json({ error: 'EPG not loaded yet' });
    }

    const tvgId = req.query.tvgId ? String(req.query.tvgId) : null;
    const hours = Math.min(48, Math.max(1, parseInt(req.query.hours, 10) || 24));

    try {
      const parsed = parser.parse(mergedEPG);
      const now = Date.now();
      const cutoff = now + hours * 60 * 60 * 1000;

      let programmes = [].concat(parsed.tv?.programme || []);

      if (tvgId) {
        programmes = programmes.filter(p => p && p['@_channel'] === tvgId);
      }

      // Keep programmes that are currently airing or start within the cutoff window
      // (allow up to 1 minute in the past so a currently-airing show is included).
      // Cache _startMs on each programme to avoid re-parsing during the sort step.
      programmes = programmes.filter(p => {
        const start = parseXMLTVDate(p['@_start']);
        const stop = p['@_stop'] ? parseXMLTVDate(p['@_stop']) : null;
        if (!start) return false;
        const startMs = start.getTime();
        const stopMs = stop ? stop.getTime() : startMs + 30 * 60 * 1000;
        p._startMs = startMs;
        return stopMs > now - 60 * 1000 && startMs < cutoff;
      });

      // Sort by start time ascending using the cached timestamp
      programmes.sort((a, b) => (a._startMs || 0) - (b._startMs || 0));

      // Limit to MAX_GUIDE_PROGRAMMES entries
      programmes = programmes.slice(0, MAX_GUIDE_PROGRAMMES);

      // Flatten to a simple shape
      const result = programmes.map(p => ({
        title: extractTextField(p.title),
        desc: extractTextField(p.desc),
        start: p['@_start'] || '',
        stop: p['@_stop'] || '',
        channel: p['@_channel'] || '',
      }));

      res.json({ programmes: result, total: result.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));
}
