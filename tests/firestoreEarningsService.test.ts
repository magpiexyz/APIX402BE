/**
 * Tests for Firestore Earnings Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test data storage
let testData: Map<string, any> = new Map();
let shouldThrowError = false;

// Mock Firestore
vi.mock('../src/db/firestoreClient.js', () => {
  const createMockSnapshot = (docs: any[]) => ({
    empty: docs.length === 0,
    docs: docs.map((data) => ({
      id: data?.id,
      data: () => data,
    })),
  });

  const mockFirestore = {
    collection: vi.fn().mockImplementation((collectionName: string) => ({
      doc: vi.fn().mockImplementation((docId: string) => {
        const key = `${collectionName}/${docId}`;
        return {
          _testKey: key,
          get: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) throw new Error('Firestore error');
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
      where: vi.fn().mockImplementation((field: string, op: string, value: any) => ({
        get: vi.fn().mockImplementation(async () => {
          if (shouldThrowError) throw new Error('Firestore error');
          const matches: any[] = [];
          testData.forEach((data, key) => {
            if (key.startsWith(collectionName) && data[field] === value) {
              matches.push(data);
            }
          });
          return createMockSnapshot(matches);
        }),
      })),
    })),
  };

  return {
    getFirestoreClient: vi.fn(() => mockFirestore),
    Collections: {
      TOKEN_EARNINGS: 'token-earnings',
    },
    FieldValue: { increment: vi.fn((n) => n) },
  };
});

import { EarningsService } from '../src/services/firestoreEarningsService.js';

describe('EarningsService', () => {
  let service: EarningsService;

  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;
    service = new EarningsService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('incrementEarnings', () => {
    it('should create new entry when none exists', async () => {
      await service.incrementEarnings(
        '0xTokenAddress',
        '0xUserAddress',
        '1000000000000000000',
        '10000'
      );

      const stored = testData.get('token-earnings/0xtokenaddress#0xuseraddress');
      expect(stored).toBeDefined();
      expect(stored.id).toBe('0xtokenaddress#0xuseraddress');
      expect(stored.tokenAddress).toBe('0xtokenaddress');
      expect(stored.userAddress).toBe('0xuseraddress');
      expect(stored.totalTokensEarned).toBe('1000000000000000000');
      expect(stored.totalFeesPaid).toBe('10000');
      expect(stored.callCount).toBe('1');
      expect(stored.claimed).toBe(false);
    });

    it('should increment existing entry with BigInt addition', async () => {
      // Seed existing entry
      testData.set('token-earnings/0xtokenaddress#0xuseraddress', {
        id: '0xtokenaddress#0xuseraddress',
        tokenAddress: '0xtokenaddress',
        userAddress: '0xuseraddress',
        totalTokensEarned: '1000000000000000000',
        totalFeesPaid: '10000',
        callCount: '5',
        lastEarnedAt: '2024-01-01T00:00:00.000Z',
        claimed: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await service.incrementEarnings(
        '0xTokenAddress',
        '0xUserAddress',
        '2000000000000000000',
        '20000'
      );

      const stored = testData.get('token-earnings/0xtokenaddress#0xuseraddress');
      expect(stored.totalTokensEarned).toBe('3000000000000000000');
      expect(stored.totalFeesPaid).toBe('30000');
      expect(stored.callCount).toBe('6');
    });

    it('should lowercase both addresses in doc ID', async () => {
      await service.incrementEarnings(
        '0xABC123',
        '0xDEF456',
        '1000',
        '100'
      );

      const stored = testData.get('token-earnings/0xabc123#0xdef456');
      expect(stored).toBeDefined();
      expect(stored.tokenAddress).toBe('0xabc123');
      expect(stored.userAddress).toBe('0xdef456');
    });

    it('should set timestamps on new entry', async () => {
      const before = new Date().toISOString();

      await service.incrementEarnings('0xToken', '0xUser', '1000', '100');

      const stored = testData.get('token-earnings/0xtoken#0xuser');
      expect(stored.createdAt).toBeDefined();
      expect(stored.updatedAt).toBeDefined();
      expect(stored.lastEarnedAt).toBeDefined();
      // All timestamps should be recent
      expect(new Date(stored.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
      expect(new Date(stored.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
      expect(new Date(stored.lastEarnedAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });

    it('should update updatedAt and lastEarnedAt but NOT createdAt on increment', async () => {
      const originalCreatedAt = '2024-01-01T00:00:00.000Z';
      testData.set('token-earnings/0xtoken#0xuser', {
        id: '0xtoken#0xuser',
        tokenAddress: '0xtoken',
        userAddress: '0xuser',
        totalTokensEarned: '1000',
        totalFeesPaid: '100',
        callCount: '1',
        lastEarnedAt: '2024-01-01T00:00:00.000Z',
        claimed: false,
        createdAt: originalCreatedAt,
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await service.incrementEarnings('0xToken', '0xUser', '500', '50');

      const stored = testData.get('token-earnings/0xtoken#0xuser');
      // createdAt should remain from original (update doesn't touch it)
      expect(stored.createdAt).toBe(originalCreatedAt);
      // updatedAt and lastEarnedAt should be updated
      expect(stored.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
      expect(stored.lastEarnedAt).not.toBe('2024-01-01T00:00:00.000Z');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(
        service.incrementEarnings('0xToken', '0xUser', '1000', '100')
      ).rejects.toThrow('Firestore error');
    });
  });

  describe('getEarningsByToken', () => {
    it('should return all earnings for a token', async () => {
      testData.set('token-earnings/0xtoken#0xuser1', {
        id: '0xtoken#0xuser1',
        tokenAddress: '0xtoken',
        userAddress: '0xuser1',
        totalTokensEarned: '1000',
        totalFeesPaid: '100',
        callCount: '1',
        claimed: false,
      });
      testData.set('token-earnings/0xtoken#0xuser2', {
        id: '0xtoken#0xuser2',
        tokenAddress: '0xtoken',
        userAddress: '0xuser2',
        totalTokensEarned: '2000',
        totalFeesPaid: '200',
        callCount: '2',
        claimed: false,
      });
      testData.set('token-earnings/0xothertoken#0xuser3', {
        id: '0xothertoken#0xuser3',
        tokenAddress: '0xothertoken',
        userAddress: '0xuser3',
        totalTokensEarned: '3000',
        totalFeesPaid: '300',
        callCount: '3',
        claimed: false,
      });

      const results = await service.getEarningsByToken('0xToken');

      expect(results).toHaveLength(2);
      expect(results.map(r => r.userAddress)).toContain('0xuser1');
      expect(results.map(r => r.userAddress)).toContain('0xuser2');
    });

    it('should return empty array when no earnings exist', async () => {
      const results = await service.getEarningsByToken('0xNonExistent');

      expect(results).toEqual([]);
    });

    it('should lowercase token address for query', async () => {
      testData.set('token-earnings/0xabc#0xuser', {
        id: '0xabc#0xuser',
        tokenAddress: '0xabc',
        userAddress: '0xuser',
        totalTokensEarned: '1000',
        totalFeesPaid: '100',
        callCount: '1',
        claimed: false,
      });

      const results = await service.getEarningsByToken('0xABC');

      expect(results).toHaveLength(1);
      expect(results[0].tokenAddress).toBe('0xabc');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(
        service.getEarningsByToken('0xToken')
      ).rejects.toThrow('Firestore error');
    });
  });

  describe('getEarningsByUser', () => {
    it('should return all earnings for a user across tokens', async () => {
      testData.set('token-earnings/0xtoken1#0xuser', {
        id: '0xtoken1#0xuser',
        tokenAddress: '0xtoken1',
        userAddress: '0xuser',
        totalTokensEarned: '1000',
        totalFeesPaid: '100',
        callCount: '1',
        claimed: false,
      });
      testData.set('token-earnings/0xtoken2#0xuser', {
        id: '0xtoken2#0xuser',
        tokenAddress: '0xtoken2',
        userAddress: '0xuser',
        totalTokensEarned: '2000',
        totalFeesPaid: '200',
        callCount: '2',
        claimed: false,
      });

      const results = await service.getEarningsByUser('0xUser');

      expect(results).toHaveLength(2);
      expect(results.map(r => r.tokenAddress)).toContain('0xtoken1');
      expect(results.map(r => r.tokenAddress)).toContain('0xtoken2');
    });

    it('should return empty array when user has no earnings', async () => {
      const results = await service.getEarningsByUser('0xNobody');

      expect(results).toEqual([]);
    });

    it('should lowercase user address for query', async () => {
      testData.set('token-earnings/0xtoken#0xabc', {
        id: '0xtoken#0xabc',
        tokenAddress: '0xtoken',
        userAddress: '0xabc',
        totalTokensEarned: '1000',
        totalFeesPaid: '100',
        callCount: '1',
        claimed: false,
      });

      const results = await service.getEarningsByUser('0xABC');

      expect(results).toHaveLength(1);
      expect(results[0].userAddress).toBe('0xabc');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(
        service.getEarningsByUser('0xUser')
      ).rejects.toThrow('Firestore error');
    });
  });

  describe('getEarning', () => {
    it('should return single entry when it exists', async () => {
      const entry = {
        id: '0xtoken#0xuser',
        tokenAddress: '0xtoken',
        userAddress: '0xuser',
        totalTokensEarned: '5000',
        totalFeesPaid: '500',
        callCount: '5',
        lastEarnedAt: '2024-06-01T00:00:00.000Z',
        claimed: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
      };
      testData.set('token-earnings/0xtoken#0xuser', entry);

      const result = await service.getEarning('0xToken', '0xUser');

      expect(result).not.toBeNull();
      expect(result?.totalTokensEarned).toBe('5000');
      expect(result?.callCount).toBe('5');
    });

    it('should return null when not found', async () => {
      const result = await service.getEarning('0xToken', '0xUser');

      expect(result).toBeNull();
    });

    it('should return null on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getEarning('0xToken', '0xUser');

      expect(result).toBeNull();
    });
  });

  describe('markAsClaimed', () => {
    it('should set claimed=true and claimTxHash', async () => {
      testData.set('token-earnings/0xtoken#0xuser', {
        id: '0xtoken#0xuser',
        tokenAddress: '0xtoken',
        userAddress: '0xuser',
        totalTokensEarned: '1000',
        totalFeesPaid: '100',
        callCount: '1',
        claimed: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await service.markAsClaimed('0xToken', '0xUser', '0xTxHash123');

      const stored = testData.get('token-earnings/0xtoken#0xuser');
      expect(stored.claimed).toBe(true);
      expect(stored.claimTxHash).toBe('0xTxHash123');
    });

    it('should update updatedAt timestamp', async () => {
      testData.set('token-earnings/0xtoken#0xuser', {
        id: '0xtoken#0xuser',
        tokenAddress: '0xtoken',
        userAddress: '0xuser',
        totalTokensEarned: '1000',
        totalFeesPaid: '100',
        callCount: '1',
        claimed: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await service.markAsClaimed('0xToken', '0xUser', '0xTxHash');

      const stored = testData.get('token-earnings/0xtoken#0xuser');
      expect(stored.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(
        service.markAsClaimed('0xToken', '0xUser', '0xTxHash')
      ).rejects.toThrow('Firestore error');
    });
  });

  describe('buildDocId (via incrementEarnings)', () => {
    it('should produce consistent doc IDs regardless of address casing', async () => {
      await service.incrementEarnings('0xABC', '0xDEF', '1000', '100');
      await service.incrementEarnings('0xabc', '0xdef', '500', '50');

      // Both calls should hit the same key — second call increments the first
      const stored = testData.get('token-earnings/0xabc#0xdef');
      expect(stored).toBeDefined();
      expect(stored.totalTokensEarned).toBe('1500');
      expect(stored.callCount).toBe('2');

      // Verify there's only one entry for this pair
      let count = 0;
      testData.forEach((_, key) => {
        if (key.includes('0xabc') && key.includes('0xdef')) count++;
      });
      expect(count).toBe(1);
    });
  });
});
