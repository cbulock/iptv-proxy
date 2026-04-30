import crypto from 'crypto';
import { getDatabase, initDatabase, transaction } from './database.js';

const DEFAULT_PROFILE_NAME = 'Default Output';
const DEFAULT_PROFILE_SLUG = 'default';

function ensureDatabaseReady() {
  return initDatabase();
}

function parseGuideNumberSortParts(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  const parts = normalized.split('.');
  if (!parts.every(part => /^\d+$/.test(part))) {
    return null;
  }

  return parts.map(part => Number(part));
}

function compareGuideNumbers(left, right) {
  const leftParts = parseGuideNumberSortParts(left);
  const rightParts = parseGuideNumberSortParts(right);

  if (!leftParts && !rightParts) {
    return String(left || '').localeCompare(String(right || ''));
  }
  if (!leftParts) {
    return 1;
  }
  if (!rightParts) {
    return -1;
  }

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];

    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
}

function compareOutputChannels(left, right) {
  const guideNumberComparison = compareGuideNumbers(left.guideNumber, right.guideNumber);
  if (guideNumberComparison !== 0) {
    return guideNumberComparison;
  }

  if ((left.position ?? 0) !== (right.position ?? 0)) {
    return (left.position ?? 0) - (right.position ?? 0);
  }

  return String(left.name || '').localeCompare(String(right.name || ''));
}

function resolveEffectiveGuideNumber(entry = {}, canonicalChannel = {}) {
  return String(entry.guideNumberOverride || canonicalChannel.guide_number || '').trim();
}

function slugifyProfileName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function hydrateProfile(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    enabled: row.enabled === 1,
    settings: row.settings_json ? JSON.parse(row.settings_json) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDefault: row.slug === DEFAULT_PROFILE_SLUG,
  };
}

function allocateProfileSlug(desiredSlug, ignoreProfileId = null) {
  ensureDatabaseReady();

  const db = getDatabase();
  const rows = ignoreProfileId
    ? db.prepare('SELECT slug FROM output_profiles WHERE id != ?').all(ignoreProfileId)
    : db.prepare('SELECT slug FROM output_profiles').all();
  const usedSlugs = new Set(rows.map(row => row.slug));
  const baseSlug = desiredSlug || 'output';
  let candidate = baseSlug;
  let suffix = 2;

  while (usedSlugs.has(candidate)) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function getProfileBySlug(slug = DEFAULT_PROFILE_SLUG) {
  ensureDatabaseReady();
  return getDatabase()
    .prepare('SELECT id, name, slug, enabled, settings_json, created_at, updated_at FROM output_profiles WHERE slug = ?')
    .get(slug);
}

export function getOutputProfile(slug = DEFAULT_PROFILE_SLUG) {
  ensureDatabaseReady();
  ensureDefaultOutputProfile();
  return hydrateProfile(getProfileBySlug(slug));
}

function ensureDefaultOutputProfile() {
  ensureDatabaseReady();

  const db = getDatabase();
  const existing = getProfileBySlug(DEFAULT_PROFILE_SLUG);

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const profile = {
    id: crypto.randomUUID(),
    name: DEFAULT_PROFILE_NAME,
    slug: DEFAULT_PROFILE_SLUG,
    enabled: 1,
    settings_json: JSON.stringify({ includePublishedOnly: true }),
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO output_profiles (
      id, name, slug, enabled, settings_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    profile.id,
    profile.name,
    profile.slug,
    profile.enabled,
    profile.settings_json,
    profile.created_at,
    profile.updated_at
  );

  return profile;
}

function buildCanonicalChannelsForProfiles(db = getDatabase()) {
  return db
    .prepare(
      `SELECT id, guide_number, name
         FROM canonical_channels
        `
    )
    .all()
    .sort((left, right) => {
      const guideNumberComparison = compareGuideNumbers(left.guide_number, right.guide_number);
      if (guideNumberComparison !== 0) {
        return guideNumberComparison;
      }

      return String(left.name || '').localeCompare(String(right.name || ''));
    });
}

function syncOutputProfileById(profileId) {
  const db = getDatabase();
  const profile = db
    .prepare('SELECT id, name, slug, enabled, settings_json, created_at, updated_at FROM output_profiles WHERE id = ?')
    .get(profileId);
  if (!profile) {
    return { error: 'profile-not-found' };
  }

  const existingProfileChannels = db
    .prepare(
      `SELECT id, canonical_channel_id, position, guide_number_override, enabled
         FROM output_profile_channels
        WHERE output_profile_id = ?`
    )
    .all(profile.id);
  const existingByCanonicalId = new Map(
    existingProfileChannels.map(row => [row.canonical_channel_id, row])
  );
  const maxExistingPosition = existingProfileChannels.reduce(
    (max, row) => Math.max(max, row.position),
    -1
  );
  const canonicalChannels = buildCanonicalChannelsForProfiles(db);

  const applySync = transaction(channels => {
    db.prepare('DELETE FROM output_profile_channels WHERE output_profile_id = ?').run(profile.id);

    const insertProfileChannel = db.prepare(
      `INSERT INTO output_profile_channels (
        id, output_profile_id, canonical_channel_id, position, guide_number_override, enabled
      ) VALUES (?, ?, ?, ?, ?, ?)`
    );

    channels.forEach((channel, index) => {
      const existing = existingByCanonicalId.get(channel.id);
      insertProfileChannel.run(
        existing?.id || crypto.randomUUID(),
        profile.id,
        channel.id,
        existing?.position ?? maxExistingPosition + index + 1,
        existing?.guide_number_override ?? null,
        existing?.enabled ?? (String(channel.guide_number || '').trim() ? 1 : 0)
      );
    });
  });

  applySync(canonicalChannels);

  return {
    profileId: profile.id,
    channels: canonicalChannels.length,
  };
}

export function syncDefaultOutputProfile() {
  ensureDatabaseReady();
  const profile = ensureDefaultOutputProfile();
  return syncOutputProfileById(profile.id);
}

export function syncAllOutputProfiles() {
  ensureDatabaseReady();

  const db = getDatabase();
  ensureDefaultOutputProfile();
  const profiles = db.prepare('SELECT id FROM output_profiles ORDER BY created_at ASC').all();

  for (const profile of profiles) {
    syncOutputProfileById(profile.id);
  }

  return { profiles: profiles.length };
}

export function listOutputProfiles() {
  ensureDatabaseReady();
  ensureDefaultOutputProfile();

  return getDatabase()
    .prepare(
      `SELECT id, name, slug, enabled, settings_json, created_at, updated_at
         FROM output_profiles
        ORDER BY created_at ASC`
    )
    .all()
    .map(hydrateProfile);
}

export function listOutputProfileEntries(slug = DEFAULT_PROFILE_SLUG) {
  ensureDatabaseReady();

  const profile = getProfileBySlug(slug);
  if (!profile) {
    return [];
  }

  return getDatabase()
    .prepare(
      `SELECT
          opc.id,
          opc.position,
          opc.guide_number_override,
          opc.enabled,
          cc.id AS canonical_id,
          cc.name AS canonical_name,
          cc.tvg_id AS canonical_tvg_id,
          cc.guide_number AS canonical_guide_number
        FROM output_profile_channels opc
        JOIN canonical_channels cc ON cc.id = opc.canonical_channel_id
      WHERE opc.output_profile_id = ?
      ORDER BY opc.position ASC, cc.name ASC`
    )
    .all(profile.id)
    .map(row => ({
      id: row.id,
      position: row.position,
      guideNumberOverride: row.guide_number_override,
      enabled: row.enabled === 1,
        canonical: {
          id: row.canonical_id,
          name: row.canonical_name,
          tvg_id: row.canonical_tvg_id,
          guideNumber: row.canonical_guide_number,
        },
      }))
    .sort((left, right) =>
      compareOutputChannels(
        {
          guideNumber: left.guideNumberOverride || left.canonical?.guideNumber,
          position: left.position,
          name: left.canonical?.name,
        },
        {
          guideNumber: right.guideNumberOverride || right.canonical?.guideNumber,
          position: right.position,
          name: right.canonical?.name,
        }
      )
    );
}

function hydrateOutputChannel(row) {
  let raw = {};
  if (row.raw_json) {
    try {
      raw = JSON.parse(row.raw_json);
    } catch (_err) {
      raw = {};
    }
  }

  return {
    ...raw,
    canonicalId: row.canonical_id,
    name: row.canonical_name,
    tvg_id: row.canonical_tvg_id || raw.tvg_id || '',
    guideNumber: row.guide_number || raw.guideNumber || '',
    logo: row.logo || raw.logo || '',
    group: row.group_name || raw.group || '',
    source: row.source_name || raw.source || '',
    original_url: row.stream_url || raw.original_url || '',
    position: row.position,
  };
}

export function getOutputProfileChannels(slug = DEFAULT_PROFILE_SLUG) {
  ensureDatabaseReady();

  const db = getDatabase();
  const profile = getProfileBySlug(slug);
  if (!profile) {
    return [];
  }

  const rows = db
    .prepare(
      `SELECT
          opc.position,
          cc.id AS canonical_id,
          cc.name AS canonical_name,
          cc.tvg_id AS canonical_tvg_id,
          COALESCE(opc.guide_number_override, cc.guide_number) AS guide_number,
          cc.logo,
          cc.group_name,
          cb.id AS binding_id,
          cb.priority,
          cb.is_preferred_stream,
          sc.raw_json,
          sc.stream_url,
          s.name AS source_name
       FROM output_profile_channels opc
       JOIN canonical_channels cc ON cc.id = opc.canonical_channel_id
       LEFT JOIN channel_bindings cb ON cb.canonical_channel_id = cc.id
        LEFT JOIN source_channels sc ON sc.id = cb.source_channel_id
        LEFT JOIN sources s ON s.id = sc.source_id
        WHERE opc.output_profile_id = ?
          AND opc.enabled = 1
          AND TRIM(COALESCE(opc.guide_number_override, cc.guide_number, '')) != ''
        ORDER BY
         opc.position ASC,
         cb.is_preferred_stream DESC,
         cb.priority ASC,
         source_name ASC`
    )
    .all(profile.id);

  const outputChannels = [];
  const seenCanonical = new Set();

  for (const row of rows) {
    if (seenCanonical.has(row.canonical_id)) {
      continue;
    }
    seenCanonical.add(row.canonical_id);
    outputChannels.push(hydrateOutputChannel(row));
  }

  return outputChannels.sort(compareOutputChannels);
}

export function updateOutputProfileEntries(slug = DEFAULT_PROFILE_SLUG, channels = []) {
  ensureDatabaseReady();

  const db = getDatabase();
  const profile = getProfileBySlug(slug);
  if (!profile) {
    return { error: 'profile-not-found' };
  }

  const existingEntries = db
    .prepare(
      `SELECT
          output_profile_channels.id AS id,
          output_profile_channels.canonical_channel_id AS canonical_channel_id,
          output_profile_channels.guide_number_override AS guide_number_override,
          cc.guide_number AS canonical_guide_number
         FROM output_profile_channels
         JOIN canonical_channels cc ON cc.id = output_profile_channels.canonical_channel_id
         WHERE output_profile_channels.output_profile_id = ?`
    )
    .all(profile.id);
  const existingByCanonicalId = new Map(existingEntries.map(row => [row.canonical_channel_id, row]));

  for (const channel of channels) {
    if (!existingByCanonicalId.has(channel.canonicalId)) {
      return { error: 'entry-not-found', canonicalId: channel.canonicalId };
    }
  }

  const applyUpdate = transaction(nextChannels => {
    const updateEntry = db.prepare(
      `UPDATE output_profile_channels
          SET position = ?,
              guide_number_override = ?,
              enabled = ?
        WHERE output_profile_id = ?
          AND canonical_channel_id = ?`
    );

      for (const channel of nextChannels) {
        const existing = existingByCanonicalId.get(channel.canonicalId);
        const effectiveGuideNumber = resolveEffectiveGuideNumber(
          { guideNumberOverride: channel.guideNumberOverride },
          { guide_number: existing?.canonical_guide_number }
        );
        updateEntry.run(
          channel.position,
          channel.guideNumberOverride || null,
          channel.enabled && effectiveGuideNumber ? 1 : 0,
          profile.id,
          channel.canonicalId
        );
    }
  });

  applyUpdate(channels);
  return listOutputProfileEntries(slug);
}

export function createOutputProfile({ name, copyFromSlug = null, enabled = true } = {}) {
  ensureDatabaseReady();

  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    return { error: 'invalid-name' };
  }

  const db = getDatabase();
  ensureDefaultOutputProfile();

  const sourceProfile = copyFromSlug ? getProfileBySlug(copyFromSlug) : null;
  if (copyFromSlug && !sourceProfile) {
    return { error: 'copy-source-not-found', slug: copyFromSlug };
  }

  const now = new Date().toISOString();
  const slug = allocateProfileSlug(slugifyProfileName(trimmedName));
  const profile = {
    id: crypto.randomUUID(),
    name: trimmedName,
    slug,
    enabled: enabled ? 1 : 0,
    settings_json: JSON.stringify({ includePublishedOnly: true }),
    created_at: now,
    updated_at: now,
  };

  const createProfile = transaction(() => {
    db.prepare(
      `INSERT INTO output_profiles (
        id, name, slug, enabled, settings_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      profile.id,
      profile.name,
      profile.slug,
      profile.enabled,
      profile.settings_json,
      profile.created_at,
      profile.updated_at
    );

    if (sourceProfile) {
      const sourceEntries = db
        .prepare(
          `SELECT canonical_channel_id, position, guide_number_override, enabled
             FROM output_profile_channels
            WHERE output_profile_id = ?
            ORDER BY position ASC`
        )
        .all(sourceProfile.id);
      const insertProfileChannel = db.prepare(
        `INSERT INTO output_profile_channels (
          id, output_profile_id, canonical_channel_id, position, guide_number_override, enabled
        ) VALUES (?, ?, ?, ?, ?, ?)`
      );

      for (const entry of sourceEntries) {
        insertProfileChannel.run(
          crypto.randomUUID(),
          profile.id,
          entry.canonical_channel_id,
          entry.position,
          entry.guide_number_override,
          entry.enabled
        );
      }
    }
  });

  createProfile();

  if (!sourceProfile) {
    syncOutputProfileById(profile.id);
  }

  return hydrateProfile(getProfileBySlug(profile.slug));
}

export function updateOutputProfile(slug = DEFAULT_PROFILE_SLUG, changes = {}) {
  ensureDatabaseReady();

  const profile = getProfileBySlug(slug);
  if (!profile) {
    return { error: 'profile-not-found' };
  }

  const nextName = changes.name === undefined ? profile.name : String(changes.name || '').trim();
  if (!nextName) {
    return { error: 'invalid-name' };
  }

  const nextEnabled =
    changes.enabled === undefined ? profile.enabled : Boolean(changes.enabled);
  if (profile.slug === DEFAULT_PROFILE_SLUG && !nextEnabled) {
    return { error: 'default-profile-required' };
  }

  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE output_profiles
          SET name = ?,
              enabled = ?,
              updated_at = ?
        WHERE id = ?`
    )
    .run(nextName, nextEnabled ? 1 : 0, now, profile.id);

  return hydrateProfile(getProfileBySlug(slug));
}

export function deleteOutputProfile(slug) {
  ensureDatabaseReady();

  const profile = getProfileBySlug(slug);
  if (!profile) {
    return { error: 'profile-not-found' };
  }
  if (profile.slug === DEFAULT_PROFILE_SLUG) {
    return { error: 'default-profile-required' };
  }

  getDatabase().prepare('DELETE FROM output_profiles WHERE id = ?').run(profile.id);
  return { deleted: true, slug: profile.slug };
}

export default {
  createOutputProfile,
  deleteOutputProfile,
  getOutputProfile,
  getOutputProfileChannels,
  listOutputProfileEntries,
  listOutputProfiles,
  syncAllOutputProfiles,
  syncDefaultOutputProfile,
  updateOutputProfile,
  updateOutputProfileEntries,
};
