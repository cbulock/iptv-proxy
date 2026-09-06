import fs from 'fs';
import { fileURLToPath } from 'url';
import axios from 'axios';
import RateLimit from 'express-rate-limit';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { decodeXmltvStream, readXmltvRecords } from './xmltv-stream.js';
import { loadAppConfigFromStore } from '../libs/app-settings-service.js';
import { getChannels } from '../libs/channels-cache.js';
import { asyncHandler, AppError } from './error-handler.js';
import { validateEPGCoverage } from '../libs/epg-validator.js';
import cacheManager from '../libs/cache-manager.js';
import { requireAuth } from './auth.js';
import { listSources } from '../libs/source-service.js';
import {
  getOutputProfile,
  getOutputProfileChannels,
  hasOutputProfileEntries,
  listOutputProfiles,
} from '../libs/output-profile-service.js';
import { listGuideBindings } from '../libs/canonical-channel-service.js';

import { getProxiedImageUrl } from '../libs/proxy-image.js';
import getBaseUrl from '../libs/getBaseUrl.js';

// Rate limiter for the public XMLTV endpoint
const epgLimiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  skip: req => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: req => req.ip || 'unknown',
});

// Module-level refresher that will be set when routes are initialized
let refreshImpl = null;
let refreshPromise = null;
let requestedRefreshRevision = 0;
let completedRefreshRevision = 0;
export async function refreshEPG() {
  if (typeof refreshImpl !== 'function') {
    throw new Error('EPG refresher not initialized');
  }

  requestedRefreshRevision += 1;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      let outcome;
      // Calls made while a refresh is in progress request one follow-up pass,
      // ensuring an old channel/guide selection never becomes the final state.
      while (completedRefreshRevision < requestedRefreshRevision) {
        const revision = requestedRefreshRevision;
        outcome = await refreshImpl(revision);
        completedRefreshRevision = revision;
      }
      return outcome;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export function hasEPGRefresh() {
  return typeof refreshImpl === 'function';
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});
const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
});

// EPG cache (replaces rewrittenXMLCache)
let epgCache = null;

// Module-level merged EPG XML string (set by setupEPGRoutes)
let mergedEPG = null;
let lastEPGSourceResults = [];
let lastEPGRefreshOutcome = null;
const lastGoodSourceXml = new Map();
let guideProgrammeIndex = new Map();

// Maximum number of programmes returned per guide query (matches /api/guide behaviour)
const MAX_GUIDE_PROGRAMMES = 20;
// Rewritten XMLTV responses can be several megabytes. Cache only a bounded
// number of request variants so arbitrary filter combinations cannot retain
// unbounded copies of the guide in memory.
const MAX_EPG_CACHE_ENTRIES = 32;
const MAX_EPG_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_XMLTV_INPUT_BYTES = 64 * 1024 * 1024;

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
  const requestBaseUrl = getBaseUrl(req);

  // Check cache. A profile affects both selected records and display names.
  const filterSource = req.query.source || '';
  const filterChannels = req.query.channels || '';
  const profileSlug = req.params.slug ? String(req.params.slug).trim() : 'default';
  const cacheKey = `${requestBaseUrl}|profile:${profileSlug}|source:${filterSource}|channels:${filterChannels}`;
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
  const now = Date.now();
  const cutoff = now + clampedHours * 60 * 60 * 1000;

  let programmes = tvgId
    ? guideProgrammeIndex.get(tvgId) || []
    : Array.from(guideProgrammeIndex.values()).flat();

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
  guideProgrammeIndex = new Map();
  lastEPGSourceResults = [];
  lastEPGRefreshOutcome = null;
  lastGoodSourceXml.clear();
  refreshPromise = null;
  requestedRefreshRevision = 0;
  completedRefreshRevision = 0;
}

export function getEPGRefreshOutcome() {
  return lastEPGRefreshOutcome;
}

/** Clear derived guide data after a state restore. */
export function invalidateEPGCache() {
  mergedEPG = null;
  guideProgrammeIndex = new Map();
  epgCache = null;
  lastEPGSourceResults = [];
}

function loadOutputChannels(slug = '') {
  if (slug) {
    const profile = getOutputProfile(slug);
    if (!profile || !profile.enabled) {
      throw new AppError('Output profile not found', 404);
    }

    return getOutputProfileChannels(slug);
  }

  const outputChannels = getOutputProfileChannels();
  return outputChannels.length > 0 || hasOutputProfileEntries() ? outputChannels : getChannels();
}

function loadChannelsForGuideMerge() {
  const enabledProfiles = listOutputProfiles().filter(profile => profile.enabled);
  const channelsByCanonicalId = new Map();

  for (const profile of enabledProfiles) {
    for (const channel of getOutputProfileChannels(profile.slug)) {
      const key = channel?.canonicalId || `${channel?.source || ''}:${channel?.name || ''}`;
      if (!key || channelsByCanonicalId.has(key)) {
        continue;
      }
      channelsByCanonicalId.set(key, channel);
    }
  }

  if (channelsByCanonicalId.size > 0) {
    return Array.from(channelsByCanonicalId.values());
  }

  return loadOutputChannels();
}

function cloneNode(node) {
  return JSON.parse(JSON.stringify(node));
}

/**
 * Deduplicate the merged XMLTV records deterministically.
 *
 * EPG sources are processed in the stable order returned by listSources()
 * (created-at, then source name), and records retain their order within each
 * source.  The first channel for an id and the first programme for
 * (channel, start, title) win.  Keeping the entire first node preserves
 * language-tagged title fields and any provider-specific metadata.
 *
 * Records missing one of the programme identity fields are preserved rather
 * than collapsed, because they cannot be safely identified as duplicates.
 *
 * @param {{tv?: {channel?: Array, programme?: Array}}} guide
 * @returns {{tv: {channel: Array, programme: Array}}}
 */
export function deduplicateXmltvRecords(guide) {
  const channels = [];
  const programmes = [];
  const channelIds = new Set();
  const programmeKeys = new Set();

  for (const channel of [].concat(guide?.tv?.channel || [])) {
    if (!channel) continue;
    const channelId = String(channel?.['@_id'] || '').trim();
    if (!channelId || !channelIds.has(channelId)) {
      channels.push(channel);
      if (channelId) channelIds.add(channelId);
    }
  }

  for (const programme of [].concat(guide?.tv?.programme || [])) {
    if (!programme) continue;
    const channelId = String(programme?.['@_channel'] || '').trim();
    const start = String(programme?.['@_start'] || '').trim();
    const title = extractTextField(programme?.title);
    const key = channelId && start && title ? `${channelId}\u0000${start}\u0000${title}` : '';

    if (!key || !programmeKeys.has(key)) {
      programmes.push(programme);
      if (key) programmeKeys.add(key);
    }
  }

  return { tv: { channel: channels, programme: programmes } };
}

function getDisplayNameValues(channel) {
  return []
    .concat(channel?.['display-name'] || [])
    .map(value => extractTextField(value))
    .filter(Boolean);
}

function rewriteOutputChannelDisplayNames(xmlString, outputChannels = []) {
  if (typeof xmlString !== 'string' || !xmlString.trim() || !outputChannels.length) {
    return xmlString;
  }

  const outputNamesByChannelId = new Map();
  for (const channel of outputChannels) {
    const channelId = channel?.tvg_id || '';
    const outputName = channel?.name || '';
    if (channelId && outputName) {
      outputNamesByChannelId.set(channelId, outputName);
    }
  }

  if (!outputNamesByChannelId.size) {
    return xmlString;
  }

  const parsed = parser.parse(xmlString);
  if (!parsed?.tv) {
    return xmlString;
  }

  for (const channel of [].concat(parsed.tv.channel || [])) {
    if (!channel) {
      continue;
    }

    const outputName = outputNamesByChannelId.get(channel['@_id']);
    if (!outputName) {
      continue;
    }

    if (!getDisplayNameValues(channel).includes(outputName)) {
      channel['display-name'] = [outputName].concat([].concat(channel['display-name'] || []));
    }
  }

  return builder.build(parsed);
}

function buildGuideSelection(outputChannels) {
  const outputChannelsByCanonicalId = new Map(
    outputChannels
      .filter(channel => channel?.canonicalId)
      .map(channel => [channel.canonicalId, channel])
  );
  const selectedGuideBindings = listGuideBindings().filter(
    binding => binding.selected && outputChannelsByCanonicalId.has(binding.canonical.id)
  );
  const selectedCanonicalIds = new Set(selectedGuideBindings.map(binding => binding.canonical.id));

  const bindingsBySource = new Map();
  for (const binding of selectedGuideBindings) {
    const outputChannel = outputChannelsByCanonicalId.get(binding.canonical.id);
    const outputChannelId = outputChannel?.tvg_id || binding.canonical.tvg_id || outputChannel?.name;
    if (!outputChannelId) {
      continue;
    }

    if (!bindingsBySource.has(binding.source.name)) {
      bindingsBySource.set(binding.source.name, []);
    }
    bindingsBySource.get(binding.source.name).push({
      inputChannelId: binding.epgChannelId,
      outputChannelId,
      outputName: outputChannel?.name || binding.canonical.name,
    });
  }

  return {
    bindingsBySource,
    selectedCanonicalIds,
  };
}

export async function setupEPGRoutes(app) {
  const appConfig = loadAppConfigFromStore();

  function loadEPGSources() {
    return listSources()
      .filter(source => source.epg)
      .map(source => ({ name: source.name, url: source.epg }));
  }

  // Initialize EPG cache with TTL from config (default: 6 hours)
  const epgTTL = (appConfig.cache?.epg_ttl ?? 21600) * 1000; // Convert seconds to milliseconds
  epgCache = cacheManager.createCache(
    'epg',
    epgTTL,
    MAX_EPG_CACHE_ENTRIES,
    MAX_EPG_CACHE_BYTES
  );
  console.log(`EPG cache initialized with TTL: ${epgTTL / 1000}s`);

  async function fetchAndMergeEPGs(revision) {
    const startTime = Date.now();
    const allChannels = loadChannelsForGuideMerge();
    const { bindingsBySource: guideBindingsBySource, selectedCanonicalIds } =
      buildGuideSelection(allChannels);
    const merged = { tv: { channel: [], programme: [] } };
    const epgSources = loadEPGSources();
    const sourceResults = [];

    for (const source of epgSources) {
      const sourceName = source.name;
      const sourceUrl = source.url;
      const sourceBindingRules = guideBindingsBySource.get(sourceName) || [];
      // An input guide channel can intentionally drive more than one
      // canonical output. Keep every selected rule so both IDs are emitted.
      const bindingRulesByInputId = new Map();
      for (const rule of sourceBindingRules) {
        if (!bindingRulesByInputId.has(rule.inputChannelId)) {
          bindingRulesByInputId.set(rule.inputChannelId, []);
        }
        bindingRulesByInputId.get(rule.inputChannelId).push(rule);
      }
      const sourceChannels = allChannels.filter(c => c.source === sourceName);
      const fallbackChannels = sourceChannels.filter(
        channel => !channel.canonicalId || !selectedCanonicalIds.has(channel.canonicalId)
      );

      const fallbackTvgIds = new Set(fallbackChannels.map(ch => ch.tvg_id).filter(Boolean));
      const fallbackNames = new Set(fallbackChannels.map(ch => ch.name).filter(Boolean));
      let usedStaleSource = false;
      let sourceFetchError = null;

      try {
        console.log(`Loading EPG: ${sourceName} (${sourceUrl})`);

        let sourceRecords;

        if (sourceUrl.startsWith('file://')) {
          const path = fileURLToPath(sourceUrl);
          try {
            const compressed = /\.gz$/i.test(path);
            sourceRecords = await readXmltvRecords(
              decodeXmltvStream(fs.createReadStream(path), compressed),
              { maxBytes: MAX_XMLTV_INPUT_BYTES }
            );
          } catch (fileErr) {
            sourceFetchError = new Error(`Failed to read file: ${fileErr.message}`);
            const lastGood = lastGoodSourceXml.get(sourceName);
            if (!lastGood || lastGood.url !== sourceUrl) {
              throw sourceFetchError;
            }
            usedStaleSource = true;
            sourceRecords = lastGood.sourceRecords;
          }
        } else {
          try {
            const response = await axios.get(sourceUrl, {
              timeout: 15000,
              validateStatus: status => status === 200,
              responseType: 'stream',
              decompress: false,
            });
            const encoding = String(response.headers['content-encoding'] || '').toLowerCase();
            const compressed = encoding.includes('gzip') || /\.gz(?:$|\?)/i.test(sourceUrl);
            sourceRecords = await readXmltvRecords(
              decodeXmltvStream(response.data, compressed),
              { maxBytes: MAX_XMLTV_INPUT_BYTES }
            );
          } catch (httpErr) {
            sourceFetchError = new Error(`Failed to fetch EPG: ${httpErr.message}`);
            const lastGood = lastGoodSourceXml.get(sourceName);
            if (!lastGood || lastGood.url !== sourceUrl) {
              throw sourceFetchError;
            }
            usedStaleSource = true;
            sourceRecords = lastGood.sourceRecords;
          }
        }

        if (!sourceRecords || (!sourceRecords.channels.length && !sourceRecords.programmes.length)) {
          throw new Error('Empty or invalid EPG data received');
        }

        if (!usedStaleSource) {
          lastGoodSourceXml.set(sourceName, { url: sourceUrl, sourceRecords });
        }

        if (sourceRecords.channels.length) {
          const channels = []
            .concat(sourceRecords.channels)
            .flatMap(channel => {
              if (!channel) {
                return [];
              }

              const selectedRules = bindingRulesByInputId.get(channel['@_id']);
              if (selectedRules) {
                return selectedRules.map(selectedRule => {
                  const rewrittenChannel = cloneNode(channel);
                  rewrittenChannel['@_id'] = selectedRule.outputChannelId;
                  if (!getDisplayNameValues(rewrittenChannel).includes(selectedRule.outputName)) {
                    rewrittenChannel['display-name'] = [selectedRule.outputName].concat(
                      [].concat(rewrittenChannel['display-name'] || [])
                    );
                  }
                  return rewrittenChannel;
                });
              }

              const displayNames = getDisplayNameValues(channel);
              if (
                fallbackTvgIds.has(channel['@_id']) ||
                displayNames.some(name => fallbackNames.has(name))
              ) {
                return [channel];
              }

              return [];
            });

          merged.tv.channel.push(...channels);

          sourceResults.push({
            source: sourceName,
            url: sourceUrl,
            status: usedStaleSource ? 'stale' : 'ok',
            ...(sourceFetchError ? { error: sourceFetchError.message } : {}),
            channelCount: channels.length,
            programmeCount: 0,
          });
        }

        let sourceProgrammeCount = 0;
        if (sourceRecords.programmes.length) {
          const programmes = []
            .concat(sourceRecords.programmes)
            .flatMap(programme => {
              if (!programme) {
                return [];
              }

              const selectedRules = bindingRulesByInputId.get(programme['@_channel']);
              if (selectedRules) {
                return selectedRules.map(selectedRule => {
                  const rewrittenProgramme = cloneNode(programme);
                  rewrittenProgramme['@_channel'] = selectedRule.outputChannelId;
                  return rewrittenProgramme;
                });
              }

              if (
                fallbackTvgIds.has(programme['@_channel']) ||
                fallbackNames.has(programme['@_channel'])
              ) {
                return [programme];
              }

              return [];
            });

          merged.tv.programme.push(...programmes);
          sourceProgrammeCount = programmes.length;
        }

        const existingSourceResult = sourceResults.find(result => result.source === sourceName);
        if (existingSourceResult) {
          existingSourceResult.programmeCount = sourceProgrammeCount;
        } else {
          sourceResults.push({
            source: sourceName,
            url: sourceUrl,
            status: usedStaleSource ? 'stale' : 'ok',
            ...(sourceFetchError ? { error: sourceFetchError.message } : {}),
            channelCount: 0,
            programmeCount: sourceProgrammeCount,
          });
        }

        console.log(`Loaded ${merged.tv.programme.length} programmes from ${sourceName}`);
      } catch (err) {
        console.error(`❌ Failed to load EPG from ${sourceName}: ${err.message}`);
        sourceResults.push({
          source: sourceName,
          url: sourceUrl,
          status: 'error',
          error: err.message,
        });

        // Provide actionable error messages
        if (sourceUrl.startsWith('file://')) {
          const path = fileURLToPath(sourceUrl);
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

    const deduplicated = deduplicateXmltvRecords(merged);
    merged.tv.channel = deduplicated.tv.channel;
    merged.tv.programme = deduplicated.tv.programme;
    guideProgrammeIndex = new Map();
    for (const programme of merged.tv.programme) {
      const channelId = programme?.['@_channel'];
      if (!channelId) continue;
      if (!guideProgrammeIndex.has(channelId)) guideProgrammeIndex.set(channelId, []);
      guideProgrammeIndex.get(channelId).push(programme);
    }

    lastEPGSourceResults = sourceResults;
    const usableSources = sourceResults.filter(result => result.status !== 'error');
    const staleSources = sourceResults.filter(result => result.status === 'stale');
    const errors = sourceResults.filter(result => result.status === 'error');

    if (usableSources.length === 0) {
      const message = epgSources.length
        ? 'All configured EPG sources failed; retained the previous guide.'
        : 'No EPG sources are configured.';
      lastEPGRefreshOutcome = {
        status: 'failed',
        revision,
        message,
        sourceResults,
        refreshedAt: new Date().toISOString(),
      };
      console.error(`[EPG] ${message}`);
      return lastEPGRefreshOutcome;
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
    lastEPGRefreshOutcome = {
      status: errors.length || staleSources.length ? 'degraded' : 'ok',
      revision,
      message:
        errors.length || staleSources.length
          ? 'Guide refreshed with stale or unavailable source data.'
          : 'Guide refreshed successfully.',
      sourceResults,
      refreshedAt: new Date().toISOString(),
    };
    console.log(
      `EPG merge completed in ${duration}ms (${merged.tv.channel.length} channels, ${merged.tv.programme.length} programmes)`
    );
    return lastEPGRefreshOutcome;
  }

  // Expose refresher
  refreshImpl = fetchAndMergeEPGs;

  await refreshEPG();

  const handleXmltvRequest = asyncHandler(async (req, res) => {
    const profileSlug = req.params.slug ? String(req.params.slug).trim() : '';
    const filterSource = req.query.source ? String(req.query.source) : null;
    const filterChannels = req.query.channels ? String(req.query.channels).split(',') : null;
    let displayNameChannels = loadOutputChannels(profileSlug);

    if (!mergedEPG) {
      throw new AppError('EPG not loaded yet', 503);
    }

    let xmlToSend = mergedEPG;

    if (typeof mergedEPG === 'string' && mergedEPG.trim()) {
      try {
        const parsed = parser.parse(mergedEPG);
        if (!parsed || !parsed.tv) {
          throw new Error('Invalid EPG structure');
        }

        // The unscoped route is the default profile, rather than the union
        // used while merging sources. Apply membership first, then intersect
        // all requested filters so they cannot expand profile visibility.
        let allowedChannels = displayNameChannels;
        if (filterSource) {
          allowedChannels = allowedChannels.filter(c => c && c.source === filterSource);
        }
        if (filterChannels) {
          const allowedChannelIds = new Set(filterChannels.map(id => id.trim()));
          allowedChannels = allowedChannels.filter(
            channel => channel?.tvg_id && allowedChannelIds.has(channel.tvg_id)
          );
        }
        displayNameChannels = allowedChannels;
        const allowedTvgIds = new Set(
          allowedChannels.map(channel => channel?.tvg_id).filter(Boolean)
        );

        if (parsed.tv) {
          const tv = parsed.tv;
          tv.channel = [].concat(tv.channel || []).filter(c => c && allowedTvgIds.has(c['@_id']));
          tv.programme = []
            .concat(tv.programme || [])
            .filter(p => p && allowedTvgIds.has(p['@_channel']));
          xmlToSend = builder.build(parsed);
        }
      } catch (filterErr) {
        console.error('[EPG] Error filtering XMLTV:', filterErr.message);
      }
    }

    xmlToSend = rewriteOutputChannelDisplayNames(xmlToSend, displayNameChannels);

    const rewritten = rewriteImageUrls(xmlToSend, req);
    res.set('Content-Type', 'application/xml');
    res.send(rewritten);
  });

  app.get('/xmltv.xml', epgLimiter, handleXmltvRequest);
  app.get('/profiles/:slug/xmltv.xml', epgLimiter, handleXmltvRequest);

  // New endpoint: validate current merged EPG
  app.get('/api/epg/validate', (req, res) => {
    if (!mergedEPG) {
      return res.status(503).json({ error: 'EPG not loaded yet' });
    }

    try {
      const channels = loadOutputChannels();
      const validation = validateEPGCoverage(mergedEPG, channels);
      const sourceErrors = lastEPGSourceResults
        .filter(source => source.status === 'error')
        .map(source => `EPG source "${source.source}" failed: ${source.error}`);
      const errors = validation.errors.concat(sourceErrors);
      const sources = {
        total: lastEPGSourceResults.length,
        valid: lastEPGSourceResults.filter(source => source.status === 'ok').length,
        stale: lastEPGSourceResults.filter(source => source.status === 'stale').length,
        failed: lastEPGSourceResults.filter(source => source.status === 'error').length,
        results: lastEPGSourceResults,
      };
      const valid = validation.valid && sourceErrors.length === 0;

      res.json({
        valid,
        summary: {
          channels: validation.channelCount,
          programmes: validation.programmeCount,
          validChannels: validation.validChannels,
          validProgrammes: validation.validProgrammes,
          errorCount: errors.length,
          warningCount: validation.warnings.length,
        },
        coverage: validation.coverage || null,
        errors,
        warnings: validation.warnings,
        details: validation.details,
        sources,
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
  app.get(
    '/api/guide',
    requireAuth,
    epgLimiter,
    asyncHandler(async (req, res) => {
      const tvgId = req.query.tvgId ? String(req.query.tvgId) : null;
      const hours = Math.min(48, Math.max(1, parseInt(req.query.hours, 10) || 24));

      const data = getGuideData(tvgId, hours);
      if (data === null) {
        return res.status(503).json({ error: 'EPG not loaded yet' });
      }

      res.json(data);
    })
  );
}
