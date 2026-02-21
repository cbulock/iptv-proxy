import fs from 'fs';
import fsPromises from 'fs/promises';
import { getDataPath } from './paths.js';

const CHANNELS_FILE = getDataPath('channels.json');

// In-memory cache
let channelsCache = null;
let cacheTimestamp = null;
let fileWatcher = null;

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
 * Load channels from disk and cache them
 * @returns {Promise<Array>}
 */
async function loadChannelsFromDisk() {
  try {
    const data = await fsPromises.readFile(CHANNELS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Channels file not found: ${CHANNELS_FILE}`);
      return [];
    }
    throw err;
  }
}

/**
 * Initialize the cache and set up file watching
 */
export async function initChannelsCache() {
  // Load initial data
  channelsCache = await loadChannelsFromDisk();
  cacheTimestamp = Date.now();
  
  let reloadInProgress = false;
  
  // Watch for file changes to invalidate cache
  if (!fileWatcher && fs.existsSync(CHANNELS_FILE)) {
    fileWatcher = fs.watch(CHANNELS_FILE, { persistent: false }, async (eventType) => {
      if (eventType === 'change') {
        // Prevent concurrent reloads
        if (reloadInProgress) {
          console.log('[Cache] Reload already in progress, skipping...');
          return;
        }
        
        reloadInProgress = true;
        console.log('[Cache] Channels file changed, reloading...');
        try {
          channelsCache = await loadChannelsFromDisk();
          cacheTimestamp = Date.now();
          console.log(`[Cache] Reloaded ${channelsCache.length} channels`);
          
          // Notify all registered callbacks
          for (const callback of updateCallbacks) {
            try {
              callback();
            } catch (err) {
              console.error('[Cache] Error in update callback:', err.message);
            }
          }
        } catch (err) {
          console.error('[Cache] Failed to reload channels:', err.message);
        } finally {
          reloadInProgress = false;
        }
      }
    });
  }
  
  console.log(`[Cache] Initialized with ${channelsCache.length} channels`);
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
 * Invalidate the cache and reload from disk
 * @returns {Promise<void>}
 */
export async function invalidateCache() {
  channelsCache = await loadChannelsFromDisk();
  cacheTimestamp = Date.now();
  console.log(`[Cache] Cache invalidated, reloaded ${channelsCache.length} channels`);
  
  // Notify all registered callbacks
  for (const callback of updateCallbacks) {
    try {
      callback();
    } catch (err) {
      console.error('[Cache] Error in update callback:', err.message);
    }
  }
}

/**
 * Clean up file watcher
 */
export function cleanupCache() {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
}
