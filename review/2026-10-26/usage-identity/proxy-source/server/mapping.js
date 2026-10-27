import express from 'express';
import { loadChannelSnapshot } from '../libs/channel-snapshot-service.js';
import { generateSuggestions, detectDuplicates } from '../libs/channel-matcher.js';
import rateLimit from 'express-rate-limit';
import { requireAuth } from './auth.js';
import { loadChannelMapFromStore } from '../libs/channel-map-service.js';

const router = express.Router();

const conflictsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs for this endpoint
  skip: req => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: req => req.ip || 'unknown',
});

const suggestionsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs for this endpoint
  skip: req => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: req => req.ip || 'unknown',
});

const duplicatesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs for this endpoint
  skip: req => req.ip === '::1' || req.ip === '127.0.0.1',
  keyGenerator: req => req.ip || 'unknown',
});

router.get('/api/mapping/conflicts', requireAuth, conflictsLimiter, async (req, res) => {
  try {
    const channels = loadChannelSnapshot();

    const byName = new Map();
    for (const ch of Array.isArray(channels) ? channels : []) {
      const name = String(ch?.name || ch?.display_name || '').trim();
      const tvg = String(ch?.tvg_id || '').trim();
      if (!name || !tvg) continue;
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(tvg);
    }

    let mapping = {};
    try {
      mapping = loadChannelMapFromStore();
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[Mapping] Could not read channel map:', err.message);
    }

    const conflicts = [];
    for (const [name, set] of byName.entries()) {
      const candidates = Array.from(set);
      if (candidates.length > 1) {
        conflicts.push({
          name,
          tvgCandidates: candidates,
          count: candidates.length,
          mapped: mapping?.[name]?.tvg_id || '',
        });
      }
    }

    // sort conflicts by name for stable output
    conflicts.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ conflicts });
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute mapping conflicts', detail: e.message });
  }
});

// New endpoint: detect duplicate channels
router.get('/api/mapping/duplicates', requireAuth, duplicatesLimiter, async (req, res) => {
  try {
    const channels = loadChannelSnapshot();

    const duplicates = detectDuplicates(channels);

    // Note: totalDuplicateChannels sums all channels in duplicate groups.
    // A channel may appear in both byName and byTvgId if it has both types of duplicates.
    res.json({
      byName: duplicates.byName,
      byTvgId: duplicates.byTvgId,
      summary: {
        duplicateNames: duplicates.byName.length,
        duplicateTvgIds: duplicates.byTvgId.length,
        totalDuplicateChannelsByName: duplicates.byName.reduce((sum, d) => sum + d.count, 0),
        totalDuplicateChannelsByTvgId: duplicates.byTvgId.reduce((sum, d) => sum + d.count, 0),
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to detect duplicates', detail: e.message });
  }
});

// New endpoint: auto-suggest mappings for unmapped channels
router.get('/api/mapping/suggestions', requireAuth, suggestionsLimiter, async (req, res) => {
  try {
    const channels = loadChannelSnapshot();

    let mapping = {};
    try {
      mapping = loadChannelMapFromStore();
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[Mapping] Could not read channel map:', err.message);
    }

    // Filter to unmapped channels
    const mapKeys = new Set(Object.keys(mapping || {}));
    const unmapped = channels.filter(ch => {
      const name = ch.name;
      const id = ch.tvg_id || '';
      return !mapKeys.has(name) && (!id || !mapKeys.has(id));
    });

    // Generate suggestions
    const threshold = parseFloat(req.query.threshold) || 0.7;
    const maxSuggestions = parseInt(req.query.max) || 3;

    const suggestions = generateSuggestions(unmapped, channels, { threshold, maxSuggestions });

    res.json({
      suggestions,
      count: suggestions.length,
      unmappedTotal: unmapped.length,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate suggestions', detail: e.message });
  }
});

export default router;
