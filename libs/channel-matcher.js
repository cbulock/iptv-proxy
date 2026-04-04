/**
 * Channel matching and suggestion utilities
 * Provides fuzzy matching and similarity scoring for channel mapping suggestions
 */

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(a, b) {
  const aLen = a.length;
  const bLen = b.length;

  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const matrix = Array(aLen + 1)
    .fill(null)
    .map(() => Array(bLen + 1).fill(0));

  for (let i = 0; i <= aLen; i++) matrix[i][0] = i;
  for (let j = 0; j <= bLen; j++) matrix[0][j] = j;

  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[aLen][bLen];
}

/**
 * Calculate similarity score between two strings (0-1, where 1 is identical)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity score
 */
function similarity(a, b) {
  if (!a || !b) return 0;

  const aNorm = String(a).toLowerCase().trim();
  const bNorm = String(b).toLowerCase().trim();

  if (aNorm === bNorm) return 1;

  const maxLen = Math.max(aNorm.length, bNorm.length);
  if (maxLen === 0) return 1;

  const distance = levenshteinDistance(aNorm, bNorm);
  return 1 - distance / maxLen;
}

/**
 * Normalize channel name for comparison
 * @param {string} name - Channel name
 * @returns {string} Normalized name
 */
function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Find potential mapping matches for a channel
 * @param {Object} channel - Channel object with name and tvg_id
 * @param {Array} candidates - Array of candidate channels to match against
 * @param {number} threshold - Minimum similarity threshold (0-1)
 * @returns {Array} Array of matches sorted by score
 */
export function findMatches(channel, candidates, threshold = 0.6) {
  if (!channel || !Array.isArray(candidates)) return [];

  const channelName = normalize(channel.name);
  const channelTvgId = normalize(channel.tvg_id);

  const matches = [];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const candidateName = normalize(candidate.name);
    const candidateTvgId = normalize(candidate.tvg_id);

    // Skip if exact match on tvg_id (already mapped)
    if (channelTvgId && candidateTvgId && channelTvgId === candidateTvgId) continue;

    // Calculate similarity scores
    const nameScore = similarity(channelName, candidateName);
    const tvgScore = channelTvgId && candidateTvgId ? similarity(channelTvgId, candidateTvgId) : 0;

    // Use best score
    const score = Math.max(nameScore, tvgScore);

    if (score >= threshold) {
      matches.push({
        candidate,
        score,
        matchType: nameScore > tvgScore ? 'name' : 'tvg_id',
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches;
}

/**
 * Generate mapping suggestions for unmapped channels
 * @param {Array} unmappedChannels - Channels without mapping
 * @param {Array} allChannels - All available channels
 * @param {Object} options - Options for matching
 * @returns {Array} Array of suggestions
 */
export function generateSuggestions(unmappedChannels, allChannels, options = {}) {
  const { threshold = 0.7, maxSuggestions = 3 } = options;

  const suggestions = [];

  for (const unmapped of unmappedChannels) {
    const matches = findMatches(unmapped, allChannels, threshold);

    if (matches.length > 0) {
      suggestions.push({
        channel: unmapped,
        suggestions: matches.slice(0, maxSuggestions).map(m => ({
          ...m.candidate,
          score: m.score,
          matchType: m.matchType,
        })),
      });
    }
  }

  return suggestions;
}

/**
 * Detect duplicate channels (same name or tvg_id)
 * @param {Array} channels - Array of channels
 * @returns {Object} Object with duplicates by name and tvg_id
 */
export function detectDuplicates(channels) {
  if (!Array.isArray(channels)) return { byName: [], byTvgId: [] };

  const nameMap = new Map();
  const tvgIdMap = new Map();

  for (const channel of channels) {
    if (!channel) continue;

    const name = String(channel.name || '').trim();
    const tvgId = String(channel.tvg_id || '').trim();

    if (name) {
      if (!nameMap.has(name)) {
        nameMap.set(name, []);
      }
      nameMap.get(name).push(channel);
    }

    if (tvgId) {
      if (!tvgIdMap.has(tvgId)) {
        tvgIdMap.set(tvgId, []);
      }
      tvgIdMap.get(tvgId).push(channel);
    }
  }

  // Filter to only duplicates
  const byName = Array.from(nameMap.entries())
    .filter(([_, channels]) => channels.length > 1)
    .map(([name, channels]) => ({
      name,
      count: channels.length,
      channels,
      sources: [...new Set(channels.map(c => c.source).filter(Boolean))],
    }));

  const byTvgId = Array.from(tvgIdMap.entries())
    .filter(([_, channels]) => channels.length > 1)
    .map(([tvgId, channels]) => ({
      tvgId,
      count: channels.length,
      channels,
      sources: [...new Set(channels.map(c => c.source).filter(Boolean))],
    }));

  return { byName, byTvgId };
}

export default {
  findMatches,
  generateSuggestions,
  detectDuplicates,
  similarity,
  normalize,
};
