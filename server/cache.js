/**
 * Cache management and statistics API
 */

import express from 'express';
import RateLimit from 'express-rate-limit';
import cacheManager from '../libs/cache-manager.js';
import { asyncHandler, AppError } from './error-handler.js';
import { requireAuth } from './auth.js';

const router = express.Router();

// Apply authentication to all /api/cache routes
router.use('/api/cache', requireAuth);

// Rate limiter for cache management endpoints
const cacheLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per window
});

/**
 * Get cache statistics
 */
router.get('/api/cache/stats', cacheLimiter, asyncHandler(async (req, res) => {
  const stats = cacheManager.getStats();
  res.json({
    caches: stats,
    timestamp: new Date().toISOString()
  });
}));

/**
 * Clear all caches
 */
router.post('/api/cache/clear', cacheLimiter, asyncHandler(async (req, res) => {
  cacheManager.clearAll();
  res.json({
    status: 'success',
    message: 'All caches cleared',
    timestamp: new Date().toISOString()
  });
}));

/**
 * Clear specific cache
 */
router.post('/api/cache/clear/:name', cacheLimiter, asyncHandler(async (req, res) => {
  const { name } = req.params;
  const cache = cacheManager.getCache(name);
  
  if (!cache) {
    throw new AppError(`Cache '${name}' not found`, 404);
  }
  
  cache.clear();
  res.json({
    status: 'success',
    message: `Cache '${name}' cleared`,
    timestamp: new Date().toISOString()
  });
}));

/**
 * Update cache TTL
 */
router.put('/api/cache/ttl/:name', cacheLimiter, asyncHandler(async (req, res) => {
  const { name } = req.params;
  const { ttl } = req.body;
  
  if (typeof ttl !== 'number' || ttl < 0) {
    throw new AppError('Invalid TTL value. Must be a non-negative number (in seconds)', 400);
  }
  
  const cache = cacheManager.getCache(name);
  
  if (!cache) {
    throw new AppError(`Cache '${name}' not found`, 404);
  }
  
  const ttlMs = ttl * 1000; // Convert seconds to milliseconds
  cache.setTTL(ttlMs);
  
  res.json({
    status: 'success',
    message: `Cache '${name}' TTL updated`,
    name,
    ttl,
    timestamp: new Date().toISOString()
  });
}));

export default router;
