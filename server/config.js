import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import axios from 'axios';
import RateLimit from 'express-rate-limit';
import { parseAll } from '../scripts/parseM3U.js';
import { refreshEPG } from './epg.js';
import { validateConfigData } from '../libs/config-loader.js';
import { invalidateCache, getChannels } from '../libs/channels-cache.js';
import { requireAuth, invalidateAuthCache } from './auth.js';
import { notifyWebhooks } from '../libs/webhooks.js';
import { loadAppConfigFromStore, replaceAppConfig } from '../libs/app-settings-service.js';
import { loadChannelMapFromStore, replaceChannelMap } from '../libs/channel-map-service.js';
import {
  loadEPGConfigFromStore,
  loadM3UConfigFromStore,
  loadProvidersConfigFromStore,
  replaceEPGConfig,
  replaceM3UConfig,
  replaceProvidersConfig,
} from '../libs/source-service.js';

const router = express.Router();

// Rate limiter for configuration write endpoints to mitigate DoS via repeated disk writes
const configWriteLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // limit each IP to 30 config write requests per window
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: req => req.ip || 'unknown',
  message: {
    error: 'Too many configuration updates from this IP, please try again later.',
  },
});

// Rate limiter for write operations (more restrictive)
const writeLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  skip: req => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: req => req.ip || 'unknown',
});

// Rate limiter for read operations (less restrictive)
const readLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  skip: req => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: req => req.ip || 'unknown',
});

function loadM3U() {
  return loadM3UConfigFromStore();
}

function loadEPG() {
  return loadEPGConfigFromStore();
}

function loadProviders() {
  return loadProvidersConfigFromStore();
}

function loadAPP() {
  return loadAppConfigFromStore();
}

function loadChannelMap() {
  return loadChannelMapFromStore();
}

router.get('/api/config/m3u', requireAuth, (req, res) => {
  try {
    res.json(loadM3U());
  } catch (e) {
    res.status(500).json({
      error: 'Failed to load M3U source compatibility view',
      detail: e.message,
      fix: 'Check that providers are configured correctly. The legacy M3U view is now synthesized from the SQLite-backed source store.',
    });
  }
});

router.get('/api/config/epg', requireAuth, (req, res) => {
  try {
    res.json(loadEPG());
  } catch (e) {
    res.status(500).json({
      error: 'Failed to load EPG compatibility view',
      detail: e.message,
      fix: 'Check that providers and their EPG URLs are configured correctly. The legacy EPG view is now synthesized from the SQLite-backed source store.',
    });
  }
});

router.get('/api/config/providers', requireAuth, (req, res) => {
  try {
    res.json(loadProviders());
  } catch (e) {
    res.status(500).json({
      error: 'Failed to read providers.yaml',
      detail: e.message,
      fix: 'Check that providers.yaml exists in the config directory and is valid YAML. See config/examples/providers.example.yaml for reference.',
    });
  }
});

router.get('/api/config/app', requireAuth, (req, res) => {
  try {
    res.json(loadAPP());
  } catch (e) {
    res.status(500).json({
      error: 'Failed to load app config',
      detail: e.message,
      fix: 'Check that the SQLite data store is available. The compatibility export is written to app.yaml using the current config directory. See config/examples/app.example.yaml for the config shape.',
    });
  }
});

router.get('/api/config/channel-map', requireAuth, (req, res) => {
  try {
    res.json(loadChannelMap());
  } catch (e) {
    res.status(500).json({
      error: 'Failed to load channel map',
      detail: e.message,
      fix: 'Check that the SQLite data store is available. The compatibility export is written to channel-map.yaml using the current config directory. See config/examples/channel-map.example.yaml for the mapping shape.',
    });
  }
});

router.put('/api/config/m3u', requireAuth, configWriteLimiter, (req, res) => {
  const incoming = req.body;
  const validation = validateConfigData('m3u', incoming);
  if (!validation.valid)
    return res.status(400).json({
      error: validation.error,
      fix: 'Ensure all M3U sources have required fields: name (string) and url (string). The type field is optional and defaults to "m3u". See config/examples/m3u.example.yaml for examples.',
    });
  try {
    replaceM3UConfig(validation.value);
    res.json({ status: 'saved' });
  } catch (e) {
    console.error('Error saving legacy M3U config view:', e);
    res.status(500).json({
      error: 'Failed to save M3U source compatibility view',
      detail: e.message,
      fix: 'Use /api/config/providers for the primary source model, or ensure the legacy M3U payload is valid.',
    });
  }
});

router.put('/api/config/epg', requireAuth, configWriteLimiter, (req, res) => {
  const incoming = req.body;
  const validation = validateConfigData('epg', incoming);
  if (!validation.valid)
    return res.status(400).json({
      error: validation.error,
      fix: 'Ensure all EPG sources have required fields: name (string) and url (string). URLs can be HTTP(S) or file:// paths. See config/examples/epg.example.yaml for examples.',
    });
  try {
    replaceEPGConfig(validation.value);
    res.json({ status: 'saved' });
  } catch (e) {
    console.error('Error saving legacy EPG config view:', e);
    res.status(e.message?.startsWith('Unknown source') ? 400 : 500).json({
      error: 'Failed to save EPG compatibility view',
      detail: e.message,
      fix: 'Ensure each legacy EPG entry matches an existing source name, or use /api/config/providers to update sources directly.',
    });
  }
});

router.put('/api/config/providers', requireAuth, configWriteLimiter, (req, res) => {
  const incoming = req.body;
  const validation = validateConfigData('providers', incoming);
  if (!validation.valid)
    return res.status(400).json({
      error: validation.error,
      fix: 'Ensure all providers have required fields: name (string) and url (string). The type field is optional ("m3u" or "hdhomerun"). The epg field is optional. See config/examples/providers.example.yaml for examples.',
    });
  try {
    replaceProvidersConfig(validation.value);
    res.json({ status: 'saved' });
  } catch (e) {
    console.error('Error saving providers:', e);
    res.status(500).json({
      error: 'Failed to save providers',
      detail: e.message,
      fix: 'Check file permissions on the config directory and ensure disk space is available.',
    });
  }
});

router.put('/api/config/app', requireAuth, configWriteLimiter, (req, res) => {
  const incoming = req.body;
  // Reject requests that try to set admin_auth via this endpoint; credentials
  // must be managed exclusively through /api/auth/setup and /api/auth/password.
  if (incoming && incoming.admin_auth !== undefined) {
    return res.status(400).json({
      error: 'admin_auth cannot be set via this endpoint',
      fix: 'Use POST /api/auth/setup or PUT /api/auth/password to manage admin credentials.',
    });
  }
  const validation = validateConfigData('app', incoming);
  if (!validation.valid)
    return res.status(400).json({
      error: validation.error,
      fix: 'The base_url field must be a valid URL if provided. See config/examples/app.example.yaml for examples and scheduler configuration.',
    });
  try {
    const updated = validation.value || {};
    // Always preserve admin_auth from existing config so saving app settings
    // does not erase credentials that were set separately.
    try {
      const existing = loadAPP() || {};
      if (existing.admin_auth) {
        updated.admin_auth = existing.admin_auth;
      }
    } catch (_) {
      /* ignore read errors */
    }
    replaceAppConfig(updated);
    invalidateAuthCache();
    res.json({ status: 'saved' });
  } catch (e) {
    console.error('Error saving app config:', e);
    res.status(500).json({
      error: 'Failed to save app config',
      detail: e.message,
      fix: 'Check that the SQLite data store is writable and that the config directory allows updating the compatibility export.',
    });
  }
});

router.put('/api/config/channel-map', requireAuth, configWriteLimiter, (req, res) => {
  const incoming = req.body || {};
  const validation = validateConfigData('channelMap', incoming);
  if (!validation.valid)
    return res.status(400).json({
      error: validation.error,
      fix: 'Channel mappings must have at least one property: name, number, tvg_id, logo, or url. Keys should match channel names or tvg_ids from your sources. The mapping shape is still compatible with config/examples/channel-map.example.yaml.',
    });
  try {
    replaceChannelMap(validation.value || {});
    res.json({ status: 'saved' });
  } catch (e) {
    console.error('Error saving channel map:', e);
    res.status(500).json({
      error: 'Failed to save channel map',
      detail: e.message,
      fix: 'Check file permissions on the config directory and ensure disk space is available.',
    });
  }
});

router.post('/api/reload/channels', requireAuth, async (req, res) => {
  try {
    const count = await parseAll();
    await invalidateCache();
    notifyWebhooks('channels.refreshed', { channels: count }).catch(err =>
      console.warn('[Config] Webhook notification failed:', err.message)
    );
    res.json({ status: 'reloaded', channels: count });
  } catch (e) {
    res.status(500).json({
      error: 'Failed to reload channels',
      detail: e.message,
      fix: 'Check that all providers in providers.yaml are accessible. Review server logs for specific source errors. See README.md troubleshooting section for common issues.',
    });
  }
});

router.post('/api/reload/epg', requireAuth, async (req, res) => {
  try {
    await refreshEPG();
    notifyWebhooks('epg.refreshed', {}).catch(err =>
      console.warn('[Config] Webhook notification failed:', err.message)
    );
    res.json({ status: 'reloaded' });
  } catch (e) {
    res.status(500).json({
      error: 'Failed to reload EPG',
      detail: e.message,
      fix: 'Check that provider EPG URLs in providers.yaml are accessible and contain valid XMLTV data. Verify channel IDs match between channel sources and EPG. See README.md troubleshooting section.',
    });
  }
});

// Get raw M3U tvg_ids from all sources (before mapping is applied)
router.get('/api/mapping/m3u-tvg-ids', requireAuth, readLimiter, async (req, res) => {
  try {
    const providers = loadProviders();
    const channelSources = (providers.providers || []).map(p => ({
      name: p.name,
      url: p.url,
      type: p.type || 'm3u',
    }));
    const allTvgIds = [];
    const tvgsBySource = {};

    if (!Array.isArray(channelSources) || channelSources.length === 0) {
      return res.json({ tvgIds: [], tvgsBySource: {} });
    }

    // Parse each M3U source to extract tvg_ids
    for (const source of channelSources) {
      if (!source.url || !source.name) continue;

      const sourceTvgIds = [];

      try {
        let data;

        if (source.url.startsWith('file://')) {
          // Local file
          const filePath = fileURLToPath(source.url);
          data = fs.readFileSync(filePath, 'utf8');
        } else if (source.type === 'hdhomerun') {
          // HDHomeRun discovery - get channel list
          const discovery = await axios.get(`${source.url}/discover.json`);
          const deviceInfo = discovery.data;
          const lineup = (await axios.get(`${deviceInfo.BaseURL}/lineup.json`)).data;

          for (const chan of lineup) {
            // HDHomeRun doesn't have tvg_id, use guideNumber instead
            if (chan.GuideNumber) {
              sourceTvgIds.push(chan.GuideNumber);
            }
          }
          tvgsBySource[source.name] = sourceTvgIds;
          allTvgIds.push(...sourceTvgIds);
          continue;
        } else {
          // HTTP/HTTPS M3U
          const response = await axios.get(source.url, {
            timeout: 30000,
            maxContentLength: 50 * 1024 * 1024,
            validateStatus: status => status === 200,
          });
          data = response.data;
        }

        // Parse M3U for tvg_ids
        if (typeof data === 'string') {
          const lines = data.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('#EXTINF')) {
              const tvgIdMatch = trimmed.match(/tvg-id="(.*?)"/);
              if (tvgIdMatch && tvgIdMatch[1]) {
                sourceTvgIds.push(tvgIdMatch[1]);
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[Mapping] Failed to parse M3U source "${source.name}": ${err.message}`);
        // Continue with other sources
      }

      tvgsBySource[source.name] = sourceTvgIds;
      allTvgIds.push(...sourceTvgIds);
    }

    // Remove duplicates and sort
    const uniqueTvgIds = Array.from(new Set(allTvgIds)).sort();

    res.json({
      tvgIds: uniqueTvgIds,
      tvgsBySource,
      count: uniqueTvgIds.length,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to parse M3U sources', detail: e.message });
  }
});

// Get available EPG channels (from all configured EPG sources)
router.get('/api/mapping/epg-channels', requireAuth, readLimiter, async (req, res) => {
  try {
    const providers = loadProviders();
    const epgSources = (providers.providers || [])
      .filter(p => p.epg)
      .map(p => ({ name: p.name, url: p.epg }));
    const epgChannels = epgSources
      .filter(s => s.url)
      .map(s => ({ source: s.name || 'Unknown', url: s.url }));

    res.json({ epgSources: epgChannels });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load EPG sources', detail: e.message });
  }
});

// Get raw M3U channel IDs (before mapping is applied)
// This shows the tvg_ids that come directly from the M3U sources
router.get('/api/mapping/m3u-channels', requireAuth, readLimiter, async (req, res) => {
  try {
    const providers = loadProviders();
    const channelSources = (providers.providers || []).map(p => ({
      name: p.name,
      url: p.url,
      type: p.type || 'm3u',
    }));
    const m3uChannels = [];

    for (const source of channelSources) {
      m3uChannels.push({
        source: source.name || 'Unknown',
        url: source.url,
        type: source.type || 'm3u',
      });
    }

    res.json({ m3uSources: m3uChannels });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load M3U sources', detail: e.message });
  }
});

// Helper data endpoints for mapping UI
router.get('/api/mapping/candidates', requireAuth, async (req, res) => {
  try {
    const providers = loadProviders();
    const channelSources = (providers.providers || []).map(p => ({
      name: p.name,
      url: p.url,
      type: p.type || 'm3u',
    }));
    const m3uSources = channelSources.map(u => u.name);

    // Get EPG sources for reference
    const epgSources = (providers.providers || []).filter(p => p.epg).map(p => p.name);

    console.log(`[Mapping] Starting candidates endpoint - found ${m3uSources.length} M3U sources`);

    // Parse M3U files directly to get tvg_ids instead of relying on cached channel snapshots
    const tvgMap = new Map(); // key: tvg_id, value: { name, sources }
    let totalParsed = 0;

    if (Array.isArray(channelSources) && channelSources.length > 0) {
      for (const source of channelSources) {
        if (!source.url || !source.name) {
          console.log('[Mapping] Skipping source - missing url or name');
          continue;
        }

        try {
          let data;

          if (source.url.startsWith('file://')) {
            // Local file
            const filePath = fileURLToPath(source.url);
            console.log(`[Mapping] Parsing local M3U from: ${filePath}`);
            data = fs.readFileSync(filePath, 'utf8');
          } else if (source.type === 'hdhomerun') {
            // HDHomeRun discovery
            console.log(`[Mapping] Fetching HDHomeRun lineup from: ${source.url}`);
            const discovery = await axios.get(`${source.url}/discover.json`, { timeout: 10000 });
            const deviceInfo = discovery.data;
            const lineup = (
              await axios.get(`${deviceInfo.BaseURL}/lineup.json`, { timeout: 10000 })
            ).data;

            let hdhrCount = 0;
            for (const chan of lineup) {
              if (chan.GuideNumber) {
                const tvgId = chan.GuideNumber;
                if (!tvgMap.has(tvgId)) {
                  tvgMap.set(tvgId, {
                    name: chan.GuideName || chan.GuideNumber,
                    sources: new Set(),
                  });
                  hdhrCount++;
                }
                tvgMap.get(tvgId).sources.add(source.name);
              }
            }
            console.log(
              `[Mapping] Parsed ${hdhrCount} channels from HDHomeRun source: ${source.name}`
            );
            totalParsed += hdhrCount;
            continue;
          } else {
            // HTTP/HTTPS M3U
            console.log(`[Mapping] Fetching M3U from HTTP(S): ${source.url}`);
            const response = await axios.get(source.url, {
              timeout: 30000,
              maxContentLength: 50 * 1024 * 1024,
              validateStatus: status => status === 200,
            });
            data = response.data;
          }

          // Parse M3U file
          if (typeof data === 'string') {
            const lines = data.split('\n');
            let sourceCount = 0;
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('#EXTINF')) {
                const tvgIdMatch = trimmed.match(/tvg-id="(.*?)"/);
                const nameMatch = trimmed.match(/,(.*)$/);

                if (tvgIdMatch && tvgIdMatch[1]) {
                  const tvgId = tvgIdMatch[1];
                  const name = nameMatch ? nameMatch[1].trim() : tvgId;

                  if (!tvgMap.has(tvgId)) {
                    tvgMap.set(tvgId, { name, sources: new Set() });
                    sourceCount++;
                  }
                  tvgMap.get(tvgId).sources.add(source.name);
                }
              }
            }
            console.log(
              `[Mapping] Parsed ${sourceCount} new tvg_ids from M3U source: ${source.name}`
            );
            totalParsed += sourceCount;
          }
        } catch (err) {
          console.error(`[Mapping] Failed to parse M3U source "${source.name}": ${err.message}`);
          console.error(err.stack);
        }
      }
    } else {
      console.log('[Mapping] No M3U sources found or m3u.urls is not an array');
    }

    // Convert to dropdown options format
    const tvgOptions = Array.from(tvgMap.entries())
      .map(([tvgId, data]) => ({
        value: tvgId,
        label: `${data.name} (${tvgId})`,
        sources: Array.from(data.sources).join(', '),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    console.log(
      `[Mapping] Finished parsing - total tvg_ids collected: ${tvgMap.size}, tvgOptions returned: ${tvgOptions.length}`
    );

    // Get EPG channel names for reference
    const epgNames = [];
    res.json({
      epgNames,
      tvgOptions,
      m3uSources,
      epgSources,
      debug: {
        uniqueTvgIds: tvgOptions.length,
        m3uSourcesParsed: m3uSources.length,
        totalParsedChannels: totalParsed,
      },
    });
  } catch (e) {
    console.error(`[Mapping] Error in candidates endpoint: ${e.message}`);
    console.error(e.stack);
    res.status(500).json({
      error: 'Failed to load candidates',
      detail: e.message,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined,
    });
  }
});

router.get('/api/mapping/unmapped', requireAuth, async (req, res) => {
  try {
    const map = loadChannelMap();
    const mapKeys = new Set(Object.keys(map || {}));
    const channels = getChannels();
    const filterSource = req.query.source ? String(req.query.source) : '';
    const suggestionsMap = new Map();
    for (const c of channels) {
      if (filterSource && c.source !== filterSource) continue;
      const name = c.name;
      const id = c.tvg_id || '';
      const keyHit = mapKeys.has(name) || (id && mapKeys.has(id));
      if (keyHit) continue;
      const k = `${name}|${id}|${c.source || ''}`;
      if (!suggestionsMap.has(k))
        suggestionsMap.set(k, { name, tvg_id: id, source: c.source || '' });
    }
    const suggestions = Array.from(suggestionsMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    res.json({ suggestions, count: suggestions.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute unmapped', detail: e.message });
  }
});

// Dynamic mapping management endpoints

router.post('/api/mapping', requireAuth, writeLimiter, async (req, res) => {
  try {
    const { key, mapping } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid key',
        fix: 'The key must be a string matching a channel name or tvg_id from your sources. Example: { "key": "NBC Los Angeles", "mapping": { "number": "4.1", "tvg_id": "nbc.la" } }',
      });
    }
    if (!mapping || typeof mapping !== 'object') {
      return res.status(400).json({
        error: 'Missing or invalid mapping object',
        fix: 'The mapping must be an object with at least one property: name, number, tvg_id, logo, or url. Example: { "number": "4.1", "tvg_id": "nbc.la" }',
      });
    }

    // Load current mappings
    const channelMap = loadChannelMap();

    // Add or update the mapping
    channelMap[key] = {
      ...channelMap[key],
      ...mapping,
    };

    // Save the updated mapping
    replaceChannelMap(channelMap);

    res.json({ status: 'saved', key, mapping: channelMap[key] });
  } catch (e) {
    res.status(500).json({
      error: 'Failed to save mapping',
      detail: e.message,
      fix: 'Check that the SQLite data store is writable and that the config directory allows updating the compatibility export.',
    });
  }
});

router.delete('/api/mapping/:key', requireAuth, writeLimiter, async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    if (!key) {
      return res.status(400).json({
        error: 'Missing key',
        fix: 'Provide a channel name or tvg_id to delete. Example: DELETE /api/mapping/Channel%20Name',
      });
    }

    // Load current mappings
    const channelMap = loadChannelMap();

    // Check if key exists
    if (!channelMap[key]) {
      return res.status(404).json({
        error: 'Mapping not found',
        fix: `No mapping exists for key "${key}". Check the exact key name in the current channel map.`,
      });
    }

    // Remove the mapping
    delete channelMap[key];

    // Save the updated mapping
    replaceChannelMap(channelMap);

    res.json({ status: 'deleted', key });
  } catch (e) {
    res.status(500).json({
      error: 'Failed to delete mapping',
      detail: e.message,
      fix: 'Check that the SQLite data store is writable and that the config directory allows updating the compatibility export.',
    });
  }
});

router.post('/api/mapping/bulk', requireAuth, writeLimiter, async (req, res) => {
  try {
    const { mappings } = req.body;
    if (!mappings || typeof mappings !== 'object') {
      return res.status(400).json({
        error: 'Missing or invalid mappings object',
        fix: 'Provide an object with channel mappings. Example: { "mappings": { "Channel A": { "number": "1" }, "Channel B": { "number": "2" } } }',
      });
    }

    // Load current mappings
    const channelMap = loadChannelMap();

    // Merge the new mappings
    let count = 0;
    for (const [key, mapping] of Object.entries(mappings)) {
      if (typeof mapping === 'object' && mapping !== null) {
        channelMap[key] = {
          ...channelMap[key],
          ...mapping,
        };
        count++;
      }
    }

    // Save the updated mapping
    replaceChannelMap(channelMap);

    res.json({ status: 'saved', count });
  } catch (e) {
    res.status(500).json({
      error: 'Failed to save bulk mappings',
      detail: e.message,
      fix: 'Check that the SQLite data store is writable and that the config directory allows updating the compatibility export.',
    });
  }
});

export default router;
