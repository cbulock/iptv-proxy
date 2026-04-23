/**
 * Shared channel-mapping utility.
 *
 * Keeping this logic in one place avoids drift between the M3U parser
 * (scripts/parseM3U.js) and the preview API (server/preview.js).
 */

/**
 * Build a reverse index from a channel map so O(n) per-entry scans are
 * replaced by O(1) hash lookups.
 *
 * The index maps each mapping's tvg_id value → { key, value } so we can
 * resolve both "reverse tvg_id match" and "guideNumber → tvg_id" lookups
 * without iterating over the entire map for every channel.
 *
 * @param {Object} map - Channel map object (key → mapping entry)
 * @returns {Map<string, {key: string, value: Object}>}
 */
export function buildReverseIndex(map) {
  const index = new Map();
  if (!map || typeof map !== 'object') return index;
  for (const [key, value] of Object.entries(map)) {
    if (value && value.tvg_id) {
      // Only store the first occurrence of a given tvg_id so the precedence
      // order in the YAML is respected.
      if (!index.has(value.tvg_id)) {
        index.set(value.tvg_id, { key, value });
      }
    }
  }
  return index;
}

/**
 * Apply a channel-map entry to a channel object (mutates and returns the channel).
 *
 * Lookup order:
 *   1. Exact key match on channel.name
 *   2. Exact key match on channel.tvg_id
 *   3. Reverse lookup: channel.tvg_id matches a mapping's tvg_id value
 *   4. Reverse lookup: channel.guideNumber matches a mapping's tvg_id value
 *      (for HDHomeRun channels that start with an empty tvg_id)
 *
 * @param {Object} channel - Channel object (mutated in place)
 * @param {Object} map     - Channel map (key → mapping entry)
 * @param {Map}   [reverseIndex] - Pre-built reverse index from buildReverseIndex().
 *                                 When omitted it is built on the fly (convenient for
 *                                 single-channel callers such as tests).
 * @returns {Object} The mutated channel
 */
export function applyMapping(channel, map, reverseIndex) {
  const idx = reverseIndex ?? buildReverseIndex(map);

  let matchedKey = null;
  let mapping = null;

  // 1. Name-based lookup
  mapping = map[channel.name];
  if (mapping) matchedKey = channel.name;

  // 2. tvg_id direct key lookup
  if (!mapping && channel.tvg_id) {
    mapping = map[channel.tvg_id];
    if (mapping) matchedKey = channel.tvg_id;
  }

  // 3. Reverse lookup by tvg_id value (supports EPG-name keyed entries)
  if (!mapping && channel.tvg_id) {
    const hit = idx.get(channel.tvg_id);
    if (hit) {
      mapping = hit.value;
      matchedKey = hit.key;
    }
  }

  // 4. Reverse lookup by guideNumber → mapping tvg_id (HDHomeRun channels
  //    start with an empty tvg_id so step 3 is skipped; their GuideNumber
  //    often matches the EPG channel id stored in tvg_id of the map entry).
  if (!mapping && !channel.tvg_id && channel.guideNumber) {
    const hit = idx.get(channel.guideNumber);
    if (hit) {
      mapping = hit.value;
      matchedKey = hit.key;
    }
  }

  if (mapping) {
    // If mapping.name is omitted and the matched key is not the source
    // name/tvg_id, treat that key as the canonical EPG/display name.
    const inferredName =
      matchedKey && matchedKey !== channel.name && matchedKey !== channel.tvg_id
        ? matchedKey
        : channel.name;
    channel.name = mapping.name || inferredName;
    channel.tvg_id = mapping.tvg_id || channel.tvg_id;
    channel.logo = mapping.logo || channel.logo;
    channel.url = mapping.url || channel.url;
    channel.guideNumber = mapping.number || channel.guideNumber;
    channel.group = mapping.group || channel.group;
  }

  // Fallback: if still no tvg_id, use guideNumber
  if (!channel.tvg_id && channel.guideNumber) {
    channel.tvg_id = channel.guideNumber;
  }

  return channel;
}
