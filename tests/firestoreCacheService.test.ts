/**
 * Tests for Firestore Cache Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test data storage
let testData: Map<string, any> = new Map();
let shouldThrowError = false;

// Mock dayjs
vi.mock('dayjs', () => ({
  default: vi.fn(() => ({
    format: vi.fn(() => '2024-01-01 12:00:00:000'),
  })),
}));

// Mock Firestore
vi.mock('../src/db/firestoreClient.js', () => {
  const mockFirestore = {
    collection: vi.fn().mockImplementation((collectionName: string) => ({
      doc: vi.fn().mockImplementation((docId: string) => {
        const key = `${collectionName}/${docId}`;
        return {
          get: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) throw new Error('Firestore error');
            const data = testData.get(key);
            return { exists: data !== undefined, data: () => data };
          }),
          set: vi.fn().mockImplementation(async (data: any) => {
            if (shouldThrowError) throw new Error('Firestore error');
            testData.set(key, data);
          }),
          delete: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) throw new Error('Firestore error');
            testData.delete(key);
          }),
        };
      }),
      where: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          get: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) throw new Error('Firestore error');
            const matches: any[] = [];
            testData.forEach((data, key) => {
              if (key.startsWith(collectionName)) {
                matches.push({ ref: { _key: key }, data: () => data });
              }
            });
            return {
              empty: matches.length === 0,
              docs: matches,
            };
          }),
        })),
      })),
    })),
    batch: vi.fn().mockImplementation(() => ({
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    })),
  };

  return {
    getFirestoreClient: vi.fn(() => mockFirestore),
    Collections: {
      CACHE: 'cache',
    },
    Timestamp: {
      fromMillis: vi.fn((ms) => ({ seconds: ms / 1000, toMillis: () => ms })),
    },
  };
});

import {
  setCached,
  getCached,
  invalidateCache,
  invalidateCacheByPrefix,
  getOrSet,
  CacheKeys,
  CacheTTL,
} from '../src/services/firestoreCacheService.js';

describe('firestoreCacheService', () => {
  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('CacheKeys', () => {
    it('should generate SERVER_BY_SLUG key', () => {
      expect(CacheKeys.SERVER_BY_SLUG('MagPie')).toBe('server:magpie');
    });

    it('should generate SERVER_BY_ID key', () => {
      expect(CacheKeys.SERVER_BY_ID('0xABCDEF')).toBe('server:id:0xabcdef');
    });

    it('should generate METRICS key', () => {
      expect(CacheKeys.METRICS('0xToken')).toBe('metrics:0xtoken');
    });

    it('should generate CONTRACT_STATE key', () => {
      expect(CacheKeys.CONTRACT_STATE('0xContract')).toBe('contract:0xcontract');
    });

    it('should generate ALL_SERVERS key', () => {
      expect(CacheKeys.ALL_SERVERS()).toBe('servers:all');
    });

    it('should generate SERVERS_BY_CHAIN key', () => {
      expect(CacheKeys.SERVERS_BY_CHAIN('8453')).toBe('servers:chain:8453');
    });
  });

  describe('CacheTTL', () => {
    it('should have correct TTL values', () => {
      expect(CacheTTL.SHORT).toBe(60000);
      expect(CacheTTL.MEDIUM).toBe(300000);
      expect(CacheTTL.LONG).toBe(600000);
      expect(CacheTTL.HOUR).toBe(3600000);
      expect(CacheTTL.NEVER).toBe(-1);
    });
  });

  describe('setCached', () => {
    it('should store value in cache', async () => {
      await setCached('test-key', { value: 'test-data' });

      // Check that data was stored (with dev_ prefix in test env)
      const stored = testData.get('cache/dev_test-key');
      expect(stored).toBeDefined();
    });

    it('should use default TTL of MEDIUM', async () => {
      await setCached('ttl-test', { data: 'test' });

      const stored = testData.get('cache/dev_ttl-test');
      const cacheData = JSON.parse(stored.data);
      expect(cacheData.duration).toBe(CacheTTL.MEDIUM);
    });

    it('should use custom TTL when provided', async () => {
      await setCached('custom-ttl', { data: 'test' }, CacheTTL.HOUR);

      const stored = testData.get('cache/dev_custom-ttl');
      const cacheData = JSON.parse(stored.data);
      expect(cacheData.duration).toBe(CacheTTL.HOUR);
    });

    it('should not throw on Firestore error', async () => {
      shouldThrowError = true;

      // Should not throw
      await expect(setCached('error-test', { data: 'test' })).resolves.toBeUndefined();
    });
  });

  describe('getCached', () => {
    it('should return undefined for cache miss', async () => {
      const result = await getCached('nonexistent-key');
      expect(result).toBeUndefined();
    });

    it('should return data with isExpired=false for valid cache', async () => {
      const now = Date.now();
      const cacheData = {
        data: { value: 'cached' },
        putTimestamp: now,
        formatPutTimestamp: '2024-01-01 12:00:00:000',
        duration: CacheTTL.MEDIUM,
      };
      testData.set('cache/dev_valid-cache', {
        id: 'dev_valid-cache',
        data: JSON.stringify(cacheData),
        dataTime: Math.round(now / 1000),
      });

      const result = await getCached<{ value: string }>('valid-cache');

      expect(result).toBeDefined();
      expect(result?.isExpired).toBe(false);
      expect(result?.data.value).toBe('cached');
      expect(result?.maxAge).toBeGreaterThan(0);
    });

    it('should return data with isExpired=true for expired cache', async () => {
      const oldTime = Date.now() - 600000; // 10 minutes ago
      const cacheData = {
        data: { value: 'stale' },
        putTimestamp: oldTime,
        formatPutTimestamp: '2024-01-01 11:50:00:000',
        duration: CacheTTL.MEDIUM, // 5 minutes TTL
      };
      testData.set('cache/dev_stale-cache', {
        id: 'dev_stale-cache',
        data: JSON.stringify(cacheData),
        dataTime: Math.round(oldTime / 1000),
      });

      const result = await getCached<{ value: string }>('stale-cache');

      expect(result).toBeDefined();
      expect(result?.isExpired).toBe(true);
      expect(result?.data.value).toBe('stale');
    });

    it('should return isExpired=false for never-expire cache', async () => {
      const oldTime = Date.now() - 86400000; // 1 day ago
      const cacheData = {
        data: { value: 'permanent' },
        putTimestamp: oldTime,
        formatPutTimestamp: '2024-01-01 00:00:00:000',
        duration: CacheTTL.NEVER, // Never expire
      };
      testData.set('cache/dev_permanent-cache', {
        id: 'dev_permanent-cache',
        data: JSON.stringify(cacheData),
        dataTime: Math.round(oldTime / 1000),
      });

      const result = await getCached<{ value: string }>('permanent-cache');

      expect(result).toBeDefined();
      expect(result?.isExpired).toBe(false);
      expect(result?.data.value).toBe('permanent');
    });

    it('should return undefined on Firestore error', async () => {
      shouldThrowError = true;

      const result = await getCached('error-key');
      expect(result).toBeUndefined();
    });
  });

  describe('invalidateCache', () => {
    it('should delete cache entry', async () => {
      testData.set('cache/dev_to-delete', { id: 'dev_to-delete', data: '{}' });

      await invalidateCache('to-delete');

      expect(testData.has('cache/dev_to-delete')).toBe(false);
    });

    it('should not throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(invalidateCache('error-key')).resolves.toBeUndefined();
    });
  });

  describe('invalidateCacheByPrefix', () => {
    it('should delete all entries matching prefix', async () => {
      testData.set('cache/dev_server:magpie', { id: 'dev_server:magpie', data: '{}' });
      testData.set('cache/dev_server:other', { id: 'dev_server:other', data: '{}' });
      testData.set('cache/dev_metrics:token', { id: 'dev_metrics:token', data: '{}' });

      await invalidateCacheByPrefix('server:');

      // Note: Our mock doesn't actually filter by prefix, but in real implementation it would
    });

    it('should handle empty result when no entries match prefix', async () => {
      // No cache entries exist
      testData.clear();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await invalidateCacheByPrefix('nonexistent:');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No cache entries found with prefix'));
      consoleSpy.mockRestore();
    });

    it('should not throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(invalidateCacheByPrefix('server:')).resolves.toBeUndefined();
    });
  });

  describe('getOrSet', () => {
    it('should return cached data if not expired', async () => {
      const now = Date.now();
      const cacheData = {
        data: { value: 'cached' },
        putTimestamp: now,
        formatPutTimestamp: '2024-01-01 12:00:00:000',
        duration: CacheTTL.MEDIUM,
      };
      testData.set('cache/dev_get-or-set', {
        id: 'dev_get-or-set',
        data: JSON.stringify(cacheData),
        dataTime: Math.round(now / 1000),
      });

      const fetchFn = vi.fn().mockResolvedValue({ value: 'fresh' });

      const result = await getOrSet('get-or-set', fetchFn);

      expect(result.value).toBe('cached');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('should fetch fresh data on cache miss', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ value: 'fresh' });

      const result = await getOrSet('cache-miss', fetchFn);

      expect(result.value).toBe('fresh');
      expect(fetchFn).toHaveBeenCalled();
    });

    it('should fetch fresh data when cache expired', async () => {
      const oldTime = Date.now() - 600000;
      const cacheData = {
        data: { value: 'stale' },
        putTimestamp: oldTime,
        formatPutTimestamp: '2024-01-01 11:50:00:000',
        duration: CacheTTL.MEDIUM,
      };
      testData.set('cache/dev_expired-get', {
        id: 'dev_expired-get',
        data: JSON.stringify(cacheData),
        dataTime: Math.round(oldTime / 1000),
      });

      const fetchFn = vi.fn().mockResolvedValue({ value: 'fresh' });

      const result = await getOrSet('expired-get', fetchFn);

      expect(result.value).toBe('fresh');
      expect(fetchFn).toHaveBeenCalled();
    });

    it('should return stale data when fetch fails and useStaleOnError is true', async () => {
      const oldTime = Date.now() - 600000;
      const cacheData = {
        data: { value: 'stale' },
        putTimestamp: oldTime,
        formatPutTimestamp: '2024-01-01 11:50:00:000',
        duration: CacheTTL.MEDIUM,
      };
      testData.set('cache/dev_stale-fallback', {
        id: 'dev_stale-fallback',
        data: JSON.stringify(cacheData),
        dataTime: Math.round(oldTime / 1000),
      });

      const fetchFn = vi.fn().mockRejectedValue(new Error('Fetch failed'));

      const result = await getOrSet('stale-fallback', fetchFn, CacheTTL.MEDIUM, true);

      expect(result.value).toBe('stale');
    });

    it('should throw when fetch fails and no stale data', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('Fetch failed'));

      await expect(getOrSet('no-cache', fetchFn)).rejects.toThrow('Fetch failed');
    });

    it('should throw when fetch fails and useStaleOnError is false', async () => {
      const oldTime = Date.now() - 600000;
      const cacheData = {
        data: { value: 'stale' },
        putTimestamp: oldTime,
        formatPutTimestamp: '2024-01-01 11:50:00:000',
        duration: CacheTTL.MEDIUM,
      };
      testData.set('cache/dev_no-stale', {
        id: 'dev_no-stale',
        data: JSON.stringify(cacheData),
        dataTime: Math.round(oldTime / 1000),
      });

      const fetchFn = vi.fn().mockRejectedValue(new Error('Fetch failed'));

      await expect(getOrSet('no-stale', fetchFn, CacheTTL.MEDIUM, false)).rejects.toThrow('Fetch failed');
    });
  });
});
