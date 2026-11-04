import { loadChannelSnapshot } from './channel-snapshot-service.js';

// In-memory cache
let channelsCache = null;

// Callback hooks for when channels are updated
const updateCallbacks = [];

/**
 * Register a callback to be called when channels are updated
 * @param {Function} callback
 */
export function onChannelsUpdate(callback) {
  updateCallbacks.push(callback);
}

/**
 * Load channels from the database snapshot and cache them.
 * @returns {Array}
 */
function loadChannelsFromSnapshot() {
  return loadChannelSnapshot();
}

/**
 * Initialize the cache from the database snapshot.
 */
export async function initChannelsCache() {
  channelsCache = loadChannelsFromSnapshot();
  console.log(`[Cache] Initialized with ${channelsCache.length} channels from database snapshot`);
}

/**
 * Get cached channels (sync after initialization)
 * Returns a shallow copy to prevent accidental mutations
 * @returns {Array}
 */
export function getChannels() {
  if (channelsCache === null) {
    throw new Error('Channels cache not initialized. Call initChannelsCache() first.');
  }
  // Return a shallow copy to prevent mutations of cached data
  return [...channelsCache];
}

/**
 * Invalidate the cache and reload from the database snapshot.
 * @returns {Promise<void>}
 */
export async function invalidateCache() {
  channelsCache = loadChannelsFromSnapshot();
  console.log(`[Cache] Cache invalidated, reloaded ${channelsCache.length} channels`);

  // Notify all registered callbacks (await to catch async errors)
  for (const callback of updateCallbacks) {
    try {
      await callback();
    } catch (err) {
      console.error('[Cache] Error in update callback:', err.message);
    }
  }
}

/**
 * Clean up cache state.
 */
export function cleanupCache() {
  channelsCache = null;
}
