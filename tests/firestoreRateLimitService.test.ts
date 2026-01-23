/**
 * Tests for Firestore Rate Limiting Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test data storage
let testData: Map<string, any> = new Map();
let shouldThrowError = false;
let errorCodeToThrow = 5; // Default to NOT_FOUND
let transactionCallback: any = null;

// Mock Firestore
vi.mock('../src/db/firestoreClient.js', () => {
  const mockFirestore = {
    collection: vi.fn().mockImplementation((collectionName: string) => ({
      doc: vi.fn().mockImplementation((docId: string) => {
        const key = `${collectionName}/${docId}`;
        return {
          _testKey: key, // Add this for transaction mock to use
          get: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) {
              const error = new Error('Firestore error');
              (error as any).code = errorCodeToThrow;
              throw error;
            }
            const data = testData.get(key);
            return { exists: data !== undefined, data: () => data };
          }),
          set: vi.fn().mockImplementation(async (data: any) => {
            if (shouldThrowError) throw new Error('Firestore error');
            testData.set(key, data);
          }),
          update: vi.fn().mockImplementation(async (updates: any) => {
            if (shouldThrowError) throw new Error('Firestore error');
            const existing = testData.get(key) || {};
            testData.set(key, { ...existing, ...updates });
          }),
        };
      }),
    })),
    runTransaction: vi.fn().mockImplementation(async (callback: any) => {
      if (shouldThrowError) {
        const error = new Error('Firestore error');
        (error as any).code = errorCodeToThrow;
        throw error;
      }
      const mockTransaction = {
        get: vi.fn().mockImplementation(async (docRef: any) => {
          const key = docRef._testKey || 'rate-limits/test-key';
          const data = testData.get(key);
          return { exists: data !== undefined, data: () => data };
        }),
        set: vi.fn().mockImplementation((docRef: any, data: any) => {
          const key = docRef._testKey || 'rate-limits/test-key';
          testData.set(key, data);
        }),
        update: vi.fn().mockImplementation((docRef: any, updates: any) => {
          const key = docRef._testKey || 'rate-limits/test-key';
          const existing = testData.get(key) || {};
          testData.set(key, { ...existing, ...updates });
        }),
      };
      transactionCallback = callback;
      return callback(mockTransaction);
    }),
  };

  return {
    getFirestoreClient: vi.fn(() => mockFirestore),
    Collections: {
      RATE_LIMITS: 'rate-limits',
    },
    FieldValue: { increment: vi.fn((n) => n) },
    Timestamp: {
      fromMillis: vi.fn((ms) => ({ seconds: ms / 1000, toMillis: () => ms })),
    },
  };
});

import {
  checkRateLimit,
  checkMultipleRateLimits,
  getRateLimitStatus,
  getIpKey,
  getWalletKey,
  getApiKey,
  getGlobalKey,
  RATE_LIMITS,
} from '../src/services/firestoreRateLimitService.js';

describe('firestoreRateLimitService', () => {
  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;
    errorCodeToThrow = 5; // Reset to NOT_FOUND
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Key generators', () => {
    it('should generate IP key correctly', () => {
      expect(getIpKey('192.168.1.1')).toBe('ip:192.168.1.1');
    });

    it('should generate wallet key correctly with lowercase', () => {
      expect(getWalletKey('0xABCDEF')).toBe('wallet:0xabcdef');
    });

    it('should generate API key correctly with lowercase', () => {
      expect(getApiKey('MagPie', 'GetQuote')).toBe('api:magpie:getquote');
    });

    it('should generate global key correctly', () => {
      expect(getGlobalKey()).toBe('global');
    });
  });

  describe('RATE_LIMITS configuration', () => {
    it('should have global rate limit config', () => {
      expect(RATE_LIMITS.global).toBeDefined();
      expect(RATE_LIMITS.global.windowMs).toBeGreaterThan(0);
      expect(RATE_LIMITS.global.max).toBeGreaterThan(0);
    });

    it('should have ip rate limit config', () => {
      expect(RATE_LIMITS.ip).toBeDefined();
      expect(RATE_LIMITS.ip.windowMs).toBeGreaterThan(0);
      expect(RATE_LIMITS.ip.max).toBeGreaterThan(0);
    });

    it('should have wallet rate limit config', () => {
      expect(RATE_LIMITS.wallet).toBeDefined();
      expect(RATE_LIMITS.wallet.windowMs).toBeGreaterThan(0);
      expect(RATE_LIMITS.wallet.max).toBeGreaterThan(0);
    });

    it('should have api rate limit config', () => {
      expect(RATE_LIMITS.api).toBeDefined();
      expect(RATE_LIMITS.api.windowMs).toBeGreaterThan(0);
      expect(RATE_LIMITS.api.max).toBeGreaterThan(0);
    });
  });

  describe('checkRateLimit', () => {
    it('should allow request when no existing entry (new window)', async () => {
      const result = await checkRateLimit('ip:192.168.1.1', 'ip');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.remaining).toBe(RATE_LIMITS.ip.max - 1);
    });

    it('should allow request when window expired (new window)', async () => {
      // Set up an old entry with expired window
      const oldWindowStart = Date.now() - 120000; // 2 minutes ago
      testData.set('rate-limits/ip:192.168.1.1', {
        id: 'ip:192.168.1.1',
        count: 50,
        windowStart: oldWindowStart,
      });

      const result = await checkRateLimit('ip:192.168.1.1', 'ip');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1); // Reset to 1
    });

    it('should block request when limit exceeded', async () => {
      // Set up entry at max limit
      const windowStart = Date.now();
      testData.set('rate-limits/ip:192.168.1.1', {
        id: 'ip:192.168.1.1',
        count: RATE_LIMITS.ip.max,
        windowStart,
      });

      const result = await checkRateLimit('ip:192.168.1.1', 'ip');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should increment count within same window', async () => {
      const windowStart = Date.now();
      testData.set('rate-limits/ip:192.168.1.1', {
        id: 'ip:192.168.1.1',
        count: 5,
        windowStart,
      });

      const result = await checkRateLimit('ip:192.168.1.1', 'ip');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(6);
    });

    it('should fail open on Firestore error (NOT_FOUND)', async () => {
      shouldThrowError = true;
      errorCodeToThrow = 5; // NOT_FOUND
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await checkRateLimit('ip:192.168.1.1', 'ip');

      expect(result.allowed).toBe(true); // Fail open
      expect(result.current).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Rate limit collection not found'));
      consoleSpy.mockRestore();
    });

    it('should fail open on Firestore error (non-NOT_FOUND)', async () => {
      shouldThrowError = true;
      errorCodeToThrow = 13; // INTERNAL error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await checkRateLimit('ip:192.168.1.1', 'ip');

      expect(result.allowed).toBe(true); // Fail open
      expect(result.current).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Rate limit check failed'), expect.anything());
      consoleSpy.mockRestore();
    });
  });

  describe('checkMultipleRateLimits', () => {
    it('should return allowed when all limits pass', async () => {
      const checks = [
        { key: 'global', type: 'global' as const },
        { key: 'ip:192.168.1.1', type: 'ip' as const },
      ];

      const result = await checkMultipleRateLimits(checks);

      expect(result.allowed).toBe(true);
    });

    it('should return failed type when one limit fails', async () => {
      // Set up IP at max limit
      const windowStart = Date.now();
      testData.set('rate-limits/ip:192.168.1.1', {
        id: 'ip:192.168.1.1',
        count: RATE_LIMITS.ip.max,
        windowStart,
      });

      const checks = [
        { key: 'global', type: 'global' as const },
        { key: 'ip:192.168.1.1', type: 'ip' as const },
      ];

      const result = await checkMultipleRateLimits(checks);

      expect(result.allowed).toBe(false);
      expect(result.failedType).toBe('ip');
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return entry when it exists', async () => {
      testData.set('rate-limits/ip:192.168.1.1', {
        id: 'ip:192.168.1.1',
        count: 10,
        windowStart: Date.now(),
      });

      const result = await getRateLimitStatus('ip:192.168.1.1');

      expect(result).toBeDefined();
      expect(result?.count).toBe(10);
    });

    it('should return null when entry does not exist', async () => {
      const result = await getRateLimitStatus('ip:nonexistent');

      expect(result).toBeNull();
    });

    it('should return null on Firestore error', async () => {
      shouldThrowError = true;

      const result = await getRateLimitStatus('ip:192.168.1.1');

      expect(result).toBeNull();
    });
  });
});
