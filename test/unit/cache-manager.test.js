import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import cacheManager, { CacheManager, Cache } from '../../libs/cache-manager.js';

describe('Cache Manager', () => {
  describe('Cache', () => {
    let cache;

    beforeEach(() => {
      cache = new Cache('test-cache', 0);
    });

    describe('Basic Operations', () => {
      it('should set and get values', () => {
        cache.set('key1', 'value1');
        const result = cache.get('key1');

        expect(result).to.equal('value1');
      });

      it('should return undefined for non-existent keys', () => {
        const result = cache.get('nonexistent');

        expect(result).to.be.undefined;
      });

      it('should check if key exists', () => {
        cache.set('key1', 'value1');

        expect(cache.has('key1')).to.be.true;
        expect(cache.has('key2')).to.be.false;
      });

      it('should delete keys', () => {
        cache.set('key1', 'value1');
        cache.delete('key1');

        expect(cache.has('key1')).to.be.false;
        expect(cache.get('key1')).to.be.undefined;
      });

      it('should clear all entries', () => {
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');
        cache.clear();

        expect(cache.size()).to.equal(0);
        expect(cache.has('key1')).to.be.false;
        expect(cache.has('key2')).to.be.false;
      });

      it('should report correct size', () => {
        expect(cache.size()).to.equal(0);

        cache.set('key1', 'value1');
        expect(cache.size()).to.equal(1);

        cache.set('key2', 'value2');
        expect(cache.size()).to.equal(2);

        cache.delete('key1');
        expect(cache.size()).to.equal(1);
      });
    });

    describe('TTL Expiration', () => {
      it('should expire entries after TTL', async () => {
        const shortTTL = new Cache('short-ttl', 50); // 50ms TTL
        shortTTL.set('key1', 'value1');

        // Should exist immediately
        expect(shortTTL.has('key1')).to.be.true;
        expect(shortTTL.get('key1')).to.equal('value1');

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 100));

        // Should be expired
        expect(shortTTL.has('key1')).to.be.false;
        expect(shortTTL.get('key1')).to.be.undefined;
      });

      it('should not expire entries with TTL=0', async () => {
        cache.set('key1', 'value1');

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(cache.has('key1')).to.be.true;
        expect(cache.get('key1')).to.equal('value1');
      });

      it('should remove expired entries from size count', async () => {
        const shortTTL = new Cache('short-ttl', 50);
        shortTTL.set('key1', 'value1');
        shortTTL.set('key2', 'value2');

        expect(shortTTL.size()).to.equal(2);

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(shortTTL.size()).to.equal(0);
      });

      it('should update TTL dynamically', async () => {
        const dynamicCache = new Cache('dynamic', 1000);
        dynamicCache.set('key1', 'value1');

        // Change TTL to very short
        dynamicCache.setTTL(50);

        await new Promise(resolve => setTimeout(resolve, 100));

        // Should be expired with new TTL
        expect(dynamicCache.has('key1')).to.be.false;
      });
    });

    describe('Statistics', () => {
      it('should track cache hits', () => {
        cache.set('key1', 'value1');

        cache.get('key1'); // hit
        cache.get('key1'); // hit

        const stats = cache.getStats();
        expect(stats.hits).to.equal(2);
      });

      it('should track cache misses', () => {
        cache.get('nonexistent'); // miss
        cache.get('another'); // miss

        const stats = cache.getStats();
        expect(stats.misses).to.equal(2);
      });

      it('should calculate hit rate', () => {
        cache.set('key1', 'value1');

        cache.get('key1'); // hit
        cache.get('key1'); // hit
        cache.get('nonexistent'); // miss

        const stats = cache.getStats();
        expect(stats.hitRate).to.equal('66.67%');
      });

      it('should return stats with cache name', () => {
        const stats = cache.getStats();

        expect(stats.name).to.equal('test-cache');
      });

      it('should include TTL in stats', () => {
        const ttlCache = new Cache('ttl-cache', 5000);
        const stats = ttlCache.getStats();

        expect(stats.ttl).to.equal(5000);
      });

      it('should include entry metadata in stats', () => {
        cache.set('key1', 'value1');

        const stats = cache.getStats();

        expect(stats.entries).to.be.an('array');
        expect(stats.entries).to.have.length(1);
        expect(stats.entries[0]).to.have.property('key', 'key1');
        expect(stats.entries[0]).to.have.property('age');
        expect(stats.entries[0]).to.have.property('expired');
      });

      it('should show TTL remaining for entries with TTL', () => {
        const ttlCache = new Cache('ttl-cache', 5000);
        ttlCache.set('key1', 'value1');

        const stats = ttlCache.getStats();

        expect(stats.entries[0]).to.have.property('ttlRemaining');
        expect(stats.entries[0].ttlRemaining).to.be.a('number');
        expect(stats.entries[0].ttlRemaining).to.be.at.most(5);
      });

      it('should handle zero hits and misses', () => {
        const stats = cache.getStats();

        expect(stats.hits).to.equal(0);
        expect(stats.misses).to.equal(0);
        expect(stats.hitRate).to.equal('0%');
      });
    });

    describe('Data Types', () => {
      it('should cache strings', () => {
        cache.set('key', 'string value');
        expect(cache.get('key')).to.equal('string value');
      });

      it('should cache numbers', () => {
        cache.set('key', 42);
        expect(cache.get('key')).to.equal(42);
      });

      it('should cache objects', () => {
        const obj = { foo: 'bar', nested: { value: 123 } };
        cache.set('key', obj);
        expect(cache.get('key')).to.deep.equal(obj);
      });

      it('should cache arrays', () => {
        const arr = [1, 2, 3, { a: 'b' }];
        cache.set('key', arr);
        expect(cache.get('key')).to.deep.equal(arr);
      });

      it('should cache null values', () => {
        cache.set('key', null);
        expect(cache.get('key')).to.be.null;
      });

      it('should cache boolean values', () => {
        cache.set('true', true);
        cache.set('false', false);
        expect(cache.get('true')).to.be.true;
        expect(cache.get('false')).to.be.false;
      });
    });
  });

  describe('CacheManager', () => {
    let manager;

    beforeEach(() => {
      manager = new CacheManager();
    });

    it('should create new caches', () => {
      const cache = manager.createCache('test', 1000);

      expect(cache).to.be.instanceOf(Cache);
      expect(cache.name).to.equal('test');
      expect(cache.ttl).to.equal(1000);
    });

    it('should retrieve existing caches', () => {
      const cache1 = manager.createCache('test', 1000);
      const cache2 = manager.getCache('test');

      expect(cache2).to.equal(cache1);
    });

    it('should return undefined for non-existent caches', () => {
      const cache = manager.getCache('nonexistent');

      expect(cache).to.be.undefined;
    });

    it('should manage multiple caches', () => {
      manager.createCache('cache1', 1000);
      manager.createCache('cache2', 2000);
      manager.createCache('cache3', 3000);

      expect(manager.getCache('cache1')).to.exist;
      expect(manager.getCache('cache2')).to.exist;
      expect(manager.getCache('cache3')).to.exist;
    });

    it('should clear all caches', () => {
      const cache1 = manager.createCache('cache1');
      const cache2 = manager.createCache('cache2');

      cache1.set('key1', 'value1');
      cache2.set('key2', 'value2');

      manager.clearAll();

      expect(cache1.size()).to.equal(0);
      expect(cache2.size()).to.equal(0);
    });

    it('should get stats for all caches', () => {
      const cache1 = manager.createCache('cache1');
      const cache2 = manager.createCache('cache2');

      cache1.set('key1', 'value1');
      cache2.set('key2', 'value2');

      const stats = manager.getStats();

      expect(stats).to.have.property('cache1');
      expect(stats).to.have.property('cache2');
      expect(stats.cache1.size).to.equal(1);
      expect(stats.cache2.size).to.equal(1);
    });
  });

  describe('Singleton cacheManager', () => {
    it('should be a CacheManager instance', () => {
      expect(cacheManager).to.be.instanceOf(CacheManager);
    });

    it('should create and manage caches', () => {
      const cache = cacheManager.createCache('singleton-test', 1000);

      expect(cache).to.be.instanceOf(Cache);
      expect(cacheManager.getCache('singleton-test')).to.equal(cache);
    });
  });
});
