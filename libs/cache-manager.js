/**
 * Centralized cache manager with TTL support
 * Manages parsed EPG and M3U data with configurable expiration
 */

class CacheManager {
  constructor() {
    this.caches = new Map();
  }

  /**
   * Create a new cache with TTL support
   * @param {string} name - Cache name
   * @param {number} ttl - Time to live in milliseconds (0 = no expiration)
   * @returns {Cache} Cache instance
   */
  createCache(name, ttl = 0) {
    const cache = new Cache(name, ttl);
    this.caches.set(name, cache);
    return cache;
  }

  /**
   * Get an existing cache by name
   * @param {string} name - Cache name
   * @returns {Cache|undefined}
   */
  getCache(name) {
    return this.caches.get(name);
  }

  /**
   * Clear all caches
   */
  clearAll() {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
  }

  /**
   * Get statistics for all caches
   * @returns {Object} Cache statistics
   */
  getStats() {
    const stats = {};
    for (const [name, cache] of this.caches.entries()) {
      stats[name] = cache.getStats();
    }
    return stats;
  }
}

class Cache {
  constructor(name, ttl = 0) {
    this.name = name;
    this.ttl = ttl; // TTL in milliseconds
    this.data = new Map();
    this.timestamps = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Set a value in the cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   */
  set(key, value) {
    this.data.set(key, value);
    this.timestamps.set(key, Date.now());
  }

  /**
   * Get a value from the cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined if not found or expired
   */
  get(key) {
    if (!this.has(key)) {
      this.misses++;
      return undefined;
    }

    // Check if expired
    if (this.ttl > 0) {
      const timestamp = this.timestamps.get(key);
      const age = Date.now() - timestamp;

      if (age > this.ttl) {
        // Expired - remove from cache
        this.delete(key);
        this.misses++;
        return undefined;
      }
    }

    this.hits++;
    return this.data.get(key);
  }

  /**
   * Check if a key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    if (!this.data.has(key)) {
      return false;
    }

    // Check expiration
    if (this.ttl > 0) {
      const timestamp = this.timestamps.get(key);
      const age = Date.now() - timestamp;

      if (age > this.ttl) {
        this.delete(key);
        return false;
      }
    }

    return true;
  }

  /**
   * Delete a key from the cache
   * @param {string} key - Cache key
   */
  delete(key) {
    this.data.delete(key);
    this.timestamps.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.data.clear();
    this.timestamps.clear();
  }

  /**
   * Get cache size
   * @returns {number}
   */
  size() {
    // Clean up expired entries before counting
    if (this.ttl > 0) {
      const now = Date.now();
      for (const [key, timestamp] of this.timestamps.entries()) {
        if (now - timestamp > this.ttl) {
          this.delete(key);
        }
      }
    }
    return this.data.size;
  }

  /**
   * Get cache statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    const size = this.size();
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(2) : 0;

    return {
      name: this.name,
      size,
      ttl: this.ttl,
      hits: this.hits,
      misses: this.misses,
      hitRate: `${hitRate}%`,
      entries: this.getEntries(),
    };
  }

  /**
   * Get all cache entries with metadata
   * @returns {Array} Array of entry objects
   */
  getEntries() {
    const entries = [];
    const now = Date.now();

    for (const [key, timestamp] of this.timestamps.entries()) {
      const age = now - timestamp;
      const ttlRemaining = this.ttl > 0 ? Math.max(0, this.ttl - age) : null;

      entries.push({
        key,
        age: Math.floor(age / 1000), // age in seconds
        ttlRemaining: ttlRemaining === null ? null : Math.floor(ttlRemaining / 1000),
        expired: this.ttl > 0 && age > this.ttl,
      });
    }

    return entries;
  }

  /**
   * Update TTL for this cache
   * @param {number} ttl - New TTL in milliseconds
   */
  setTTL(ttl) {
    this.ttl = ttl;
  }
}

// Singleton instance
const cacheManager = new CacheManager();

export default cacheManager;
export { CacheManager, Cache };
