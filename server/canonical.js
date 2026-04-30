import express from 'express';
import { requireAuth } from './auth.js';
import {
  listCanonicalChannels,
  listChannelBindings,
  listGuideBindings,
  rebuildCanonicalChannels,
  setCanonicalChannelPublished,
  setCanonicalChannelGuideBinding,
  setCanonicalChannelPreferredStream,
} from '../libs/canonical-channel-service.js';
import {
  createOutputProfile,
  deleteOutputProfile,
  getOutputProfileChannels,
  listOutputProfileEntries,
  listOutputProfiles,
  syncAllOutputProfiles,
  updateOutputProfileEntries,
  updateOutputProfile,
} from '../libs/output-profile-service.js';
import { getDatabase, initDatabase } from '../libs/database.js';
import { invalidateLineupCaches } from './lineup.js';
import { hasEPGRefresh, refreshEPG } from './epg.js';
import { getProxiedImageUrl } from '../libs/proxy-image.js';

const router = express.Router();
let canonicalModelWarmup = null;

async function ensureCanonicalModelReady() {
  initDatabase();

  const db = getDatabase();
  const loadCounts = () =>
    db.prepare(
      `SELECT
          (SELECT COUNT(*) FROM source_channels) AS source_channels,
          (SELECT COUNT(*) FROM canonical_channels) AS canonical_channels,
          (SELECT COUNT(*) FROM output_profile_channels) AS output_profile_channels`
    ).get();

  const counts = loadCounts();
  if (
    counts.source_channels === 0 ||
    (counts.canonical_channels > 0 && counts.output_profile_channels > 0)
  ) {
    return;
  }

  if (!canonicalModelWarmup) {
    canonicalModelWarmup = Promise.resolve()
      .then(() => {
        const current = loadCounts();
        if (current.source_channels === 0) {
          return;
        }
        if (current.canonical_channels === 0) {
          rebuildCanonicalChannels();
        }
        if (
          current.canonical_channels === 0 ||
          loadCounts().output_profile_channels === 0
        ) {
          syncAllOutputProfiles();
        }
      })
      .finally(() => {
        canonicalModelWarmup = null;
      });
  }

  await canonicalModelWarmup;
}

router.get('/api/canonical/channels', requireAuth, async (_req, res) => {
  try {
    await ensureCanonicalModelReady();
    res.json({ channels: listCanonicalChannels() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load canonical channels', detail: err.message });
  }
});

router.get('/api/canonical/bindings', requireAuth, async (_req, res) => {
  try {
    await ensureCanonicalModelReady();
    res.json({ bindings: listChannelBindings() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load channel bindings', detail: err.message });
  }
});

router.get('/api/canonical/guide-bindings', requireAuth, async (_req, res) => {
  try {
    await ensureCanonicalModelReady();
    res.json({ bindings: listGuideBindings() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load guide bindings', detail: err.message });
  }
});

router.get('/api/output-profiles', requireAuth, async (_req, res) => {
  try {
    await ensureCanonicalModelReady();
    res.json({ profiles: listOutputProfiles() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load output profiles', detail: err.message });
  }
});

router.post('/api/output-profiles', requireAuth, async (req, res) => {
  try {
    await ensureCanonicalModelReady();
    const profile = createOutputProfile({
      name: req.body?.name,
      copyFromSlug:
        typeof req.body?.copyFromSlug === 'string' && req.body.copyFromSlug.trim()
          ? req.body.copyFromSlug.trim()
          : null,
      enabled: req.body?.enabled === undefined ? true : Boolean(req.body.enabled),
    });

    if (profile?.error === 'invalid-name') {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    if (profile?.error === 'copy-source-not-found') {
      return res.status(404).json({ error: 'Source output profile not found' });
    }

    invalidateLineupCaches();
    if (hasEPGRefresh()) {
      await refreshEPG();
    }

    res.status(201).json({ status: 'created', profile });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create output profile', detail: err.message });
  }
});

router.patch('/api/output-profiles/:slug', requireAuth, async (req, res) => {
  try {
    await ensureCanonicalModelReady();
    const profile = updateOutputProfile(req.params.slug, {
      name: req.body?.name,
      enabled: req.body?.enabled,
    });

    if (profile?.error === 'profile-not-found') {
      return res.status(404).json({ error: 'Output profile not found' });
    }
    if (profile?.error === 'invalid-name') {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    if (profile?.error === 'default-profile-required') {
      return res.status(400).json({ error: 'Default output profile must remain enabled' });
    }

    invalidateLineupCaches();
    if (hasEPGRefresh()) {
      await refreshEPG();
    }

    res.json({ status: 'saved', profile });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update output profile', detail: err.message });
  }
});

router.delete('/api/output-profiles/:slug', requireAuth, async (req, res) => {
  try {
    await ensureCanonicalModelReady();
    const result = deleteOutputProfile(req.params.slug);

    if (result?.error === 'profile-not-found') {
      return res.status(404).json({ error: 'Output profile not found' });
    }
    if (result?.error === 'default-profile-required') {
      return res.status(400).json({ error: 'Default output profile cannot be deleted' });
    }

    invalidateLineupCaches();
    if (hasEPGRefresh()) {
      await refreshEPG();
    }

    res.json({ status: 'deleted', slug: result.slug });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete output profile', detail: err.message });
  }
});

router.get('/api/output-profiles/:slug/channels', requireAuth, async (req, res) => {
  try {
    await ensureCanonicalModelReady();
    res.json({
      channels: getOutputProfileChannels(req.params.slug).map(channel => ({
        ...channel,
        logo: channel.logo
          ? getProxiedImageUrl(channel.logo, channel.source || 'unknown', req)
          : '',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load output profile channels', detail: err.message });
  }
});

router.get('/api/output-profiles/:slug/entries', requireAuth, async (req, res) => {
  try {
    await ensureCanonicalModelReady();
    res.json({ channels: listOutputProfileEntries(req.params.slug) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load output profile entries', detail: err.message });
  }
});

router.patch('/api/canonical/channels/:id', requireAuth, async (req, res) => {
  try {
    await ensureCanonicalModelReady();
    if (typeof req.body?.published !== 'boolean') {
      return res.status(400).json({ error: 'published must be a boolean' });
    }

    const channel = setCanonicalChannelPublished(req.params.id, req.body.published);
    if (!channel) {
      return res.status(404).json({ error: 'Canonical channel not found' });
    }

    syncAllOutputProfiles();
    invalidateLineupCaches();
    if (hasEPGRefresh()) {
      await refreshEPG();
    }

    res.json({ status: 'saved', channel });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update canonical channel', detail: err.message });
  }
});

router.patch('/api/canonical/channels/:id/preferred-stream', requireAuth, async (req, res) => {
  try {
    await ensureCanonicalModelReady();
    if (typeof req.body?.sourceChannelId !== 'string' || !req.body.sourceChannelId.trim()) {
      return res.status(400).json({ error: 'sourceChannelId must be a non-empty string' });
    }

    const binding = setCanonicalChannelPreferredStream(req.params.id, req.body.sourceChannelId);
    if (binding?.error === 'canonical-not-found') {
      return res.status(404).json({ error: 'Canonical channel not found' });
    }
    if (binding?.error === 'binding-not-found') {
      return res.status(404).json({ error: 'Binding not found for canonical channel' });
    }

    invalidateLineupCaches();
    if (hasEPGRefresh()) {
      await refreshEPG();
    }

    res.json({ status: 'saved', binding });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update preferred stream', detail: err.message });
  }
});

router.patch('/api/canonical/channels/:id/guide-binding', requireAuth, async (req, res) => {
  try {
    await ensureCanonicalModelReady();
    if (typeof req.body?.sourceId !== 'string' || !req.body.sourceId.trim()) {
      return res.status(400).json({ error: 'sourceId must be a non-empty string' });
    }
    if (typeof req.body?.epgChannelId !== 'string' || !req.body.epgChannelId.trim()) {
      return res.status(400).json({ error: 'epgChannelId must be a non-empty string' });
    }

    const binding = setCanonicalChannelGuideBinding(
      req.params.id,
      req.body.sourceId,
      req.body.epgChannelId
    );
    if (binding?.error === 'canonical-not-found') {
      return res.status(404).json({ error: 'Canonical channel not found' });
    }
    if (binding?.error === 'guide-binding-not-found') {
      return res.status(404).json({ error: 'Guide binding not found for canonical channel' });
    }

    if (hasEPGRefresh()) {
      await refreshEPG();
    }

    res.json({ status: 'saved', binding });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update guide binding', detail: err.message });
  }
});

router.patch('/api/output-profiles/:slug/channels', requireAuth, async (req, res) => {
  try {
    await ensureCanonicalModelReady();
    if (!Array.isArray(req.body?.channels)) {
      return res.status(400).json({ error: 'channels must be an array' });
    }

    const channels = req.body.channels.map(channel => ({
      canonicalId: String(channel?.canonicalId || '').trim(),
      position: channel?.position,
      enabled: channel?.enabled,
      guideNumberOverride: channel?.guideNumberOverride ?? null,
    }));

    for (const channel of channels) {
      if (!channel.canonicalId) {
        return res.status(400).json({ error: 'canonicalId must be a non-empty string' });
      }
      if (!Number.isInteger(channel.position) || channel.position < 0) {
        return res.status(400).json({ error: 'position must be a non-negative integer' });
      }
      if (typeof channel.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      if (
        channel.guideNumberOverride !== null &&
        typeof channel.guideNumberOverride !== 'string'
      ) {
        return res.status(400).json({ error: 'guideNumberOverride must be a string or null' });
      }
    }

    const updatedChannels = updateOutputProfileEntries(req.params.slug, channels);
    if (updatedChannels?.error === 'profile-not-found') {
      return res.status(404).json({ error: 'Output profile not found' });
    }
    if (updatedChannels?.error === 'entry-not-found') {
      return res
        .status(404)
        .json({ error: `Output profile entry not found for canonical channel ${updatedChannels.canonicalId}` });
    }

    invalidateLineupCaches();
    if (hasEPGRefresh()) {
      await refreshEPG();
    }

    res.json({ status: 'saved', channels: updatedChannels });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update output profile channels', detail: err.message });
  }
});

export default router;
