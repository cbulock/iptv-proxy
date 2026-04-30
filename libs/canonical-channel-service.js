import crypto from 'crypto';
import { buildReverseIndex, resolveChannelMapping, applyMapping } from './channel-mapping.js';
import { getDatabase, initDatabase, transaction } from './database.js';
import { loadChannelMapFromStore } from './channel-map-service.js';

function ensureDatabaseReady() {
  return initDatabase();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function allocateUniqueSlug(preferredSlug, usedSlugs, fallbackIndex) {
  const baseSlug = preferredSlug || `channel-${fallbackIndex}`;
  let candidate = baseSlug;
  let suffix = 2;

  while (usedSlugs.has(candidate)) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  usedSlugs.add(candidate);
  return candidate;
}

function hydrateSourceChannel(row) {
  if (row.raw_json) {
    try {
      return JSON.parse(row.raw_json);
    } catch (_err) {
      // Fall back to the structured columns below.
    }
  }

  return {
    name: row.name,
    tvg_id: row.tvg_id || '',
    logo: row.logo || '',
    group: row.group_name || '',
    guideNumber: row.guide_number || '',
    original_url: row.stream_url || '',
  };
}

function getCanonicalIdentity(channel) {
  return [channel.tvg_id || '', channel.guideNumber || '', channel.name || ''].join('|');
}

function hydrateCanonicalChannel(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tvg_id: row.tvg_id,
    guideNumber: row.guide_number,
    logo: row.logo,
    group: row.group_name,
    published: row.published === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hydrateBindingRow(row) {
  return {
    id: row.id,
    source_channel_id: row.source_channel_id,
    canonical_channel_id: row.canonical_channel_id,
    binding_type: row.binding_type,
    priority: row.priority,
    is_preferred_stream: row.is_preferred_stream,
    confidence: row.confidence,
    resolution_state: row.resolution_state,
  };
}

function hydrateGuideBindingRow(row) {
  return {
    id: row.id,
    canonical_channel_id: row.canonical_channel_id,
    source_id: row.source_id,
    epg_channel_id: row.epg_channel_id,
    priority: row.priority,
  };
}

export function rebuildCanonicalChannels() {
  ensureDatabaseReady();

  const mapping = loadChannelMapFromStore();
  const reverseIndex = buildReverseIndex(mapping);
  const db = getDatabase();
  const existingCanonicalByIdentity = new Map(
    db
      .prepare(
        `SELECT id, slug, name, tvg_id, guide_number, published, created_at
           FROM canonical_channels`
      )
      .all()
      .map(row => [
        getCanonicalIdentity({
          name: row.name,
          tvg_id: row.tvg_id,
          guideNumber: row.guide_number,
        }),
        row,
      ])
  );
  const existingCanonicalIdentityById = new Map(
    Array.from(existingCanonicalByIdentity.entries()).map(([identity, row]) => [row.id, identity])
  );
  const existingBindingsByKey = new Map(
    db
      .prepare(
        `SELECT
            cb.id,
            cb.source_channel_id,
            cb.canonical_channel_id,
            cb.binding_type,
            cb.priority,
            cb.is_preferred_stream,
            cb.confidence,
            cb.resolution_state
         FROM channel_bindings cb`
      )
      .all()
      .map(row => [`${row.canonical_channel_id}|${row.source_channel_id}`, hydrateBindingRow(row)])
  );
  const existingGuideBindingsByKey = new Map(
    db
      .prepare(
        `SELECT
            gb.id,
            gb.canonical_channel_id,
            gb.source_id,
            gb.epg_channel_id,
            gb.priority
         FROM guide_bindings gb`
      )
      .all()
      .map(row => [`${row.canonical_channel_id}|${row.source_id}`, hydrateGuideBindingRow(row)])
  );
  const existingOutputProfileRows = db
    .prepare(
      `SELECT id, output_profile_id, canonical_channel_id, position, guide_number_override, enabled
         FROM output_profile_channels`
    )
    .all();
  const sourceChannels = db
    .prepare(
      `SELECT id, source_id, name, tvg_id, logo, group_name, guide_number, stream_url, raw_json
         FROM source_channels
        ORDER BY source_id ASC, name ASC`
    )
    .all();

  const canonicalByIdentity = new Map();
  const canonicalRows = [];
  const bindingRows = [];
  const guideBindingRows = [];
  const seenGuideBindings = new Set();
  const usedSlugs = new Set();

  for (const sourceChannel of sourceChannels) {
    const hydrated = hydrateSourceChannel(sourceChannel);
    const resolution = resolveChannelMapping(hydrated, mapping, reverseIndex);
    const canonicalChannel = applyMapping({ ...hydrated }, mapping, reverseIndex);
    const identity = getCanonicalIdentity(canonicalChannel);
    if (!identity.replace(/\|/g, '')) {
      continue;
    }

    let canonicalId = canonicalByIdentity.get(identity);
    if (!canonicalId) {
      const preserved = existingCanonicalByIdentity.get(identity);
      canonicalId = preserved?.id || crypto.randomUUID();
      const now = new Date().toISOString();
      canonicalByIdentity.set(identity, canonicalId);
      canonicalRows.push({
        id: canonicalId,
        slug: allocateUniqueSlug(
          preserved?.slug || slugify(canonicalChannel.tvg_id || canonicalChannel.name),
          usedSlugs,
          canonicalRows.length + 1
        ),
        name: canonicalChannel.name,
        tvg_id: canonicalChannel.tvg_id || null,
        guide_number: canonicalChannel.guideNumber || null,
        logo: canonicalChannel.logo || null,
        group_name: canonicalChannel.group || null,
        published: preserved?.published ?? 1,
        created_at: preserved?.created_at || now,
        updated_at: now,
      });
    }

    const existingBinding = existingBindingsByKey.get(`${canonicalId}|${sourceChannel.id}`);
    bindingRows.push({
      id: existingBinding?.id || crypto.randomUUID(),
      source_channel_id: sourceChannel.id,
      canonical_channel_id: canonicalId,
      binding_type:
        existingBinding?.binding_type || (resolution.matched ? 'mapping' : 'source'),
      priority: existingBinding?.priority || 0,
      is_preferred_stream: existingBinding?.is_preferred_stream || 0,
      confidence: existingBinding?.confidence ?? 1,
      resolution_state:
        existingBinding?.resolution_state || (resolution.matched ? 'resolved' : 'discovered'),
    });

    if (canonicalChannel.tvg_id) {
      const guideKey = `${canonicalId}|${sourceChannel.source_id}`;
      if (!seenGuideBindings.has(guideKey)) {
        seenGuideBindings.add(guideKey);
        const preservedGuideBinding = existingGuideBindingsByKey.get(guideKey);
        guideBindingRows.push({
          id: preservedGuideBinding?.id || crypto.randomUUID(),
          canonical_channel_id: canonicalId,
          source_id: sourceChannel.source_id,
          epg_channel_id: preservedGuideBinding?.epg_channel_id || canonicalChannel.tvg_id,
          priority: preservedGuideBinding?.priority ?? 1,
        });
      }
    }
  }

  const bindingRowsByCanonical = new Map();
  for (const row of bindingRows) {
    if (!bindingRowsByCanonical.has(row.canonical_channel_id)) {
      bindingRowsByCanonical.set(row.canonical_channel_id, []);
    }
    bindingRowsByCanonical.get(row.canonical_channel_id).push(row);
  }

  for (const rows of bindingRowsByCanonical.values()) {
    if (!rows.some(row => row.is_preferred_stream === 1) && rows.length > 0) {
      rows[0].is_preferred_stream = 1;
    }
  }

  const guideBindingRowsByCanonical = new Map();
  for (const row of guideBindingRows) {
    if (!guideBindingRowsByCanonical.has(row.canonical_channel_id)) {
      guideBindingRowsByCanonical.set(row.canonical_channel_id, []);
    }
    guideBindingRowsByCanonical.get(row.canonical_channel_id).push(row);
  }

  for (const rows of guideBindingRowsByCanonical.values()) {
    if (!rows.some(row => row.priority === 0) && rows.length > 0) {
      rows[0].priority = 0;
    }
  }

  const applyRebuild = transaction(() => {
    db.prepare('DELETE FROM guide_bindings').run();
    db.prepare('DELETE FROM channel_bindings').run();
    db.prepare('DELETE FROM canonical_channels').run();

    const insertCanonical = db.prepare(`
      INSERT INTO canonical_channels (
        id, slug, name, tvg_id, guide_number, logo, group_name, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertBinding = db.prepare(`
      INSERT INTO channel_bindings (
        id, source_channel_id, canonical_channel_id, binding_type, priority, is_preferred_stream, confidence, resolution_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertGuideBinding = db.prepare(`
      INSERT INTO guide_bindings (
        id, canonical_channel_id, source_id, epg_channel_id, priority
      ) VALUES (?, ?, ?, ?, ?)
    `);
    const insertOutputProfileChannel = db.prepare(`
      INSERT INTO output_profile_channels (
        id, output_profile_id, canonical_channel_id, position, guide_number_override, enabled
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const row of canonicalRows) {
      insertCanonical.run(
        row.id,
        row.slug,
        row.name,
        row.tvg_id,
        row.guide_number,
        row.logo,
        row.group_name,
        row.published,
        row.created_at,
        row.updated_at
      );
    }

    for (const row of bindingRows) {
      insertBinding.run(
        row.id,
        row.source_channel_id,
        row.canonical_channel_id,
        row.binding_type,
        row.priority,
        row.is_preferred_stream,
        row.confidence,
        row.resolution_state
      );
    }

    for (const row of guideBindingRows) {
      insertGuideBinding.run(
        row.id,
        row.canonical_channel_id,
        row.source_id,
        row.epg_channel_id,
        row.priority
      );
    }

    for (const row of existingOutputProfileRows) {
      const identity = existingCanonicalIdentityById.get(row.canonical_channel_id);
      const nextCanonicalId = identity ? canonicalByIdentity.get(identity) : null;
      if (!nextCanonicalId) {
        continue;
      }

      insertOutputProfileChannel.run(
        row.id,
        row.output_profile_id,
        nextCanonicalId,
        row.position,
        row.guide_number_override,
        row.enabled
      );
    }
  });

  applyRebuild();

  return {
    canonicalChannels: canonicalRows.length,
    bindings: bindingRows.length,
    guideBindings: guideBindingRows.length,
  };
}

export function listCanonicalChannels() {
  ensureDatabaseReady();

  return getDatabase()
    .prepare(
      `SELECT id, slug, name, tvg_id, guide_number, logo, group_name, published, created_at, updated_at
         FROM canonical_channels
         ORDER BY guide_number ASC, name ASC`
    )
    .all()
    .map(hydrateCanonicalChannel);
}

export function listChannelBindings() {
  ensureDatabaseReady();

  return getDatabase()
    .prepare(
      `SELECT
          cb.id,
          cb.binding_type,
          cb.priority,
          cb.is_preferred_stream,
          cb.confidence,
          cb.resolution_state,
          cc.id AS canonical_id,
          cc.name AS canonical_name,
          cc.tvg_id AS canonical_tvg_id,
          sc.id AS source_channel_id,
          sc.name AS source_channel_name,
          sc.tvg_id AS source_channel_tvg_id,
          sc.guide_number AS source_channel_guide_number,
          sc.raw_json AS source_channel_raw_json,
          s.name AS source_name
        FROM channel_bindings cb
       JOIN canonical_channels cc ON cc.id = cb.canonical_channel_id
       JOIN source_channels sc ON sc.id = cb.source_channel_id
       JOIN sources s ON s.id = sc.source_id
       ORDER BY cc.name ASC, s.name ASC, sc.name ASC`
    )
    .all()
    .map(row => {
      const rawSourceChannel = hydrateSourceChannel({
        name: row.source_channel_name,
        tvg_id: row.source_channel_tvg_id,
        guide_number: row.source_channel_guide_number,
        raw_json: row.source_channel_raw_json,
      });

      return {
        id: row.id,
        bindingType: row.binding_type,
        priority: row.priority,
        isPreferredStream: row.is_preferred_stream === 1,
        confidence: row.confidence,
        resolutionState: row.resolution_state,
        canonical: {
          id: row.canonical_id,
          name: row.canonical_name,
          tvg_id: row.canonical_tvg_id,
        },
        sourceChannel: {
          id: row.source_channel_id,
          name: row.source_channel_name,
          tvg_id: row.source_channel_tvg_id,
          source: row.source_name,
          guideNumber: rawSourceChannel.guideNumber || '',
          sourceGuideNumber: rawSourceChannel.sourceGuideNumber || '',
        },
      };
    });
}

export function listGuideBindings() {
  ensureDatabaseReady();

  return getDatabase()
    .prepare(
      `SELECT
          gb.id,
          gb.epg_channel_id,
          gb.priority,
          cc.id AS canonical_id,
          cc.name AS canonical_name,
          cc.tvg_id AS canonical_tvg_id,
          s.id AS source_id,
          s.name AS source_name
       FROM guide_bindings gb
       JOIN canonical_channels cc ON cc.id = gb.canonical_channel_id
       JOIN sources s ON s.id = gb.source_id
       ORDER BY cc.name ASC, gb.priority ASC, s.name ASC`
    )
    .all()
    .map(row => ({
      id: row.id,
      epgChannelId: row.epg_channel_id,
      priority: row.priority,
      selected: row.priority === 0,
      canonical: {
        id: row.canonical_id,
        name: row.canonical_name,
        tvg_id: row.canonical_tvg_id,
      },
      source: {
        id: row.source_id,
        name: row.source_name,
      },
    }));
}

export function setCanonicalChannelPublished(canonicalId, published) {
  ensureDatabaseReady();

  const db = getDatabase();
  const result = db
    .prepare(
      `UPDATE canonical_channels
          SET published = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(published ? 1 : 0, new Date().toISOString(), canonicalId);

  if (result.changes === 0) {
    return null;
  }

  const row = db
    .prepare(
      `SELECT id, slug, name, tvg_id, guide_number, logo, group_name, published, created_at, updated_at
         FROM canonical_channels
        WHERE id = ?`
    )
    .get(canonicalId);

  return hydrateCanonicalChannel(row);
}

export function setCanonicalChannelPreferredStream(canonicalId, sourceChannelId) {
  ensureDatabaseReady();

  const db = getDatabase();
  const canonicalExists = db.prepare('SELECT id FROM canonical_channels WHERE id = ?').get(canonicalId);
  if (!canonicalExists) {
    return { error: 'canonical-not-found' };
  }

  const binding = db
    .prepare(
      `SELECT cb.id
         FROM channel_bindings cb
        WHERE cb.canonical_channel_id = ?
          AND cb.source_channel_id = ?`
    )
    .get(canonicalId, sourceChannelId);

  if (!binding) {
    return { error: 'binding-not-found' };
  }

  const applyUpdate = transaction(() => {
    db.prepare(
      `UPDATE channel_bindings
          SET is_preferred_stream = CASE WHEN source_channel_id = ? THEN 1 ELSE 0 END
        WHERE canonical_channel_id = ?`
    ).run(sourceChannelId, canonicalId);
  });

  applyUpdate();

  return listChannelBindings().find(
    row => row.canonical.id === canonicalId && row.sourceChannel.id === sourceChannelId
  );
}

export function setCanonicalChannelGuideBinding(canonicalId, sourceId, epgChannelId) {
  ensureDatabaseReady();

  const db = getDatabase();
  const canonicalExists = db.prepare('SELECT id FROM canonical_channels WHERE id = ?').get(canonicalId);
  if (!canonicalExists) {
    return { error: 'canonical-not-found' };
  }

  const binding = db
    .prepare(
      `SELECT id
         FROM guide_bindings
        WHERE canonical_channel_id = ?
          AND source_id = ?`
    )
    .get(canonicalId, sourceId);

  if (!binding) {
    return { error: 'guide-binding-not-found' };
  }

  const applyUpdate = transaction(() => {
    db.prepare(
      `UPDATE guide_bindings
          SET epg_channel_id = CASE WHEN source_id = ? THEN ? ELSE epg_channel_id END,
              priority = CASE WHEN source_id = ? THEN 0 ELSE 1 END
        WHERE canonical_channel_id = ?`
    ).run(sourceId, epgChannelId, sourceId, canonicalId);
  });

  applyUpdate();

  return listGuideBindings().find(
    row => row.canonical.id === canonicalId && row.source.id === sourceId
  );
}

export default {
  listCanonicalChannels,
  listChannelBindings,
  listGuideBindings,
  rebuildCanonicalChannels,
  setCanonicalChannelPublished,
  setCanonicalChannelPreferredStream,
  setCanonicalChannelGuideBinding,
};
