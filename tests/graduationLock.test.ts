import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track mock data and control behavior
let mockData = new Map<string, any>();
let shouldThrowOnTransaction = false;
let shouldThrowOnDelete = false;

const mockDocRef = (key: string) => ({
  _testKey: key,
  delete: vi.fn().mockImplementation(async () => {
    if (shouldThrowOnDelete) throw new Error('Firestore delete error');
    mockData.delete(key);
  }),
});

const mockFirestore = {
  collection: vi.fn().mockImplementation((collectionName: string) => ({
    doc: vi.fn().mockImplementation((docId: string) => {
      const key = `${collectionName}/${docId}`;
      return mockDocRef(key);
    }),
  })),
  runTransaction: vi.fn().mockImplementation(async (callback: any) => {
    if (shouldThrowOnTransaction) throw new Error('Transaction error');
    const txn = {
      get: vi.fn().mockImplementation(async (docRef: any) => {
        const data = mockData.get(docRef._testKey);
        return { exists: data !== undefined, data: () => data };
      }),
      set: vi.fn().mockImplementation((docRef: any, data: any) => {
        mockData.set(docRef._testKey, data);
      }),
    };
    return callback(txn);
  }),
};

vi.mock('../src/db/firestoreClient.js', () => ({
  getFirestoreClient: vi.fn(() => mockFirestore),
  Collections: {
    GRADUATION_LOCKS: 'graduation-locks',
  },
}));

import { acquireGraduationLock, releaseGraduationLock } from '../src/services/graduationLock.js';

describe('graduationLock', () => {
  beforeEach(() => {
    mockData.clear();
    shouldThrowOnTransaction = false;
    shouldThrowOnDelete = false;
    vi.clearAllMocks();
  });

  describe('acquireGraduationLock', () => {
    it('should acquire lock when no lock exists', async () => {
      const result = await acquireGraduationLock('0xABC123');
      expect(result).toBe(true);

      const lockData = mockData.get('graduation-locks/0xabc123');
      expect(lockData).toBeDefined();
      expect(lockData.tokenAddress).toBe('0xabc123');
      expect(lockData.lockedAt).toBeDefined();
      expect(lockData.expiresAt).toBeDefined();
    });

    it('should normalize token address to lowercase', async () => {
      await acquireGraduationLock('0xABCDEF');

      const lockData = mockData.get('graduation-locks/0xabcdef');
      expect(lockData).toBeDefined();
      expect(lockData.tokenAddress).toBe('0xabcdef');
    });

    it('should fail to acquire lock when active lock exists', async () => {
      // Set an active (non-expired) lock
      mockData.set('graduation-locks/0xabc123', {
        tokenAddress: '0xabc123',
        lockedAt: new Date().toISOString(), // just now — not expired
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      });

      const result = await acquireGraduationLock('0xABC123');
      expect(result).toBe(false);
    });

    it('should acquire lock when existing lock has expired', async () => {
      // Set an expired lock (6 minutes ago)
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      mockData.set('graduation-locks/0xabc123', {
        tokenAddress: '0xabc123',
        lockedAt: sixMinutesAgo,
        expiresAt: new Date(Date.now() - 60000).toISOString(),
      });

      const result = await acquireGraduationLock('0xABC123');
      expect(result).toBe(true);

      // Lock should be overwritten with new timestamp
      const lockData = mockData.get('graduation-locks/0xabc123');
      expect(new Date(lockData.lockedAt).getTime()).toBeGreaterThan(
        new Date(sixMinutesAgo).getTime()
      );
    });

    it('should acquire lock when existing lock is exactly at TTL boundary', async () => {
      // Set lock at exactly 5 minutes ago (TTL = 5 min, so now - lockedAt >= TTL)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      mockData.set('graduation-locks/0xabc123', {
        tokenAddress: '0xabc123',
        lockedAt: fiveMinutesAgo,
        expiresAt: new Date().toISOString(),
      });

      const result = await acquireGraduationLock('0xABC123');
      expect(result).toBe(true);
    });

    it('should not acquire lock when lock is 4 minutes old', async () => {
      const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000).toISOString();
      mockData.set('graduation-locks/0xabc123', {
        tokenAddress: '0xabc123',
        lockedAt: fourMinutesAgo,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });

      const result = await acquireGraduationLock('0xABC123');
      expect(result).toBe(false);
    });

    it('should throw on transaction error', async () => {
      shouldThrowOnTransaction = true;
      await expect(acquireGraduationLock('0xABC123')).rejects.toThrow('Transaction error');
    });

    it('should handle different token addresses independently', async () => {
      const result1 = await acquireGraduationLock('0xTOKEN1');
      const result2 = await acquireGraduationLock('0xTOKEN2');

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(mockData.has('graduation-locks/0xtoken1')).toBe(true);
      expect(mockData.has('graduation-locks/0xtoken2')).toBe(true);
    });
  });

  describe('releaseGraduationLock', () => {
    it('should delete the lock document', async () => {
      mockData.set('graduation-locks/0xabc123', {
        tokenAddress: '0xabc123',
        lockedAt: new Date().toISOString(),
      });

      await releaseGraduationLock('0xABC123');

      expect(mockFirestore.collection).toHaveBeenCalledWith('graduation-locks');
    });

    it('should normalize token address to lowercase', async () => {
      await releaseGraduationLock('0xABCDEF');

      const collectionCall = mockFirestore.collection.mock.results[0].value;
      expect(collectionCall.doc).toHaveBeenCalledWith('0xabcdef');
    });

    it('should not throw on delete error (lock expires via TTL)', async () => {
      shouldThrowOnDelete = true;
      // Should not throw
      await expect(releaseGraduationLock('0xABC123')).resolves.toBeUndefined();
    });
  });
});
