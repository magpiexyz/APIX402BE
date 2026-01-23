/**
 * Tests for Firestore User Request Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test data storage
let testData: Map<string, any> = new Map();
let shouldThrowError = false;

// Mock Firestore
vi.mock('../src/db/firestoreClient.js', () => {
  const createMockSnapshot = (docs: any[]) => ({
    docs: docs.map((data, index) => ({
      id: data?.id || `doc-${index}`,
      data: () => data,
    })),
  });

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
          update: vi.fn().mockImplementation(async (updates: any) => {
            if (shouldThrowError) throw new Error('Firestore error');
            const existing = testData.get(key) || {};
            testData.set(key, { ...existing, ...updates });
          }),
        };
      }),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation((n: number) => ({
        get: vi.fn().mockImplementation(async () => {
          if (shouldThrowError) throw new Error('Firestore error');
          const matches: any[] = [];
          testData.forEach((data, key) => {
            if (key.startsWith(collectionName)) matches.push(data);
          });
          // Sort by createdAt descending
          matches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          return createMockSnapshot(matches.slice(0, n));
        }),
      })),
      get: vi.fn().mockImplementation(async () => {
        if (shouldThrowError) throw new Error('Firestore error');
        const matches: any[] = [];
        testData.forEach((data, key) => {
          if (key.startsWith(collectionName)) matches.push(data);
        });
        return createMockSnapshot(matches);
      }),
    })),
  };

  return {
    getFirestoreClient: vi.fn(() => mockFirestore),
    Collections: {
      USER_REQUESTS: 'user-requests',
      REQUEST_QUEUE: 'request-queue',
    },
    FieldValue: { increment: vi.fn((n) => n) },
  };
});

import { UserRequestService, type UserRequestDBEntry, type RequestQueueDBEntry } from '../src/services/firestoreUserRequestService.js';

describe('UserRequestService', () => {
  let service: UserRequestService;

  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;
    service = new UserRequestService('us-west-1', 'user-requests', 'request-queue');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getOrCreateUserRequest', () => {
    it('should return existing user request', async () => {
      const existing: UserRequestDBEntry = {
        id: '0xtoken#0xuser',
        iaoToken: '0xtoken',
        from: '0xuser',
        totalRequest: '10',
        fulfilledRequest: '8',
        refundRequest: '2',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      testData.set('user-requests/0xtoken#0xuser', existing);

      const result = await service.getOrCreateUserRequest('0xtoken', '0xuser');

      expect(result.totalRequest).toBe('10');
      expect(result.id).toBe('0xtoken#0xuser');
    });

    it('should create new user request if not exists', async () => {
      const result = await service.getOrCreateUserRequest('0xNewToken', '0xNewUser');

      expect(result.totalRequest).toBe('0');
      expect(result.fulfilledRequest).toBe('0');
      expect(result.refundRequest).toBe('0');
      expect(result.iaoToken).toBe('0xnewtoken'); // lowercase
      expect(result.from).toBe('0xnewuser'); // lowercase
    });

    it('should normalize EVM addresses to lowercase', async () => {
      const result = await service.getOrCreateUserRequest('0xABCDEF', '0x123456');

      expect(result.iaoToken).toBe('0xabcdef');
      expect(result.from).toBe('0x123456');
      expect(result.id).toBe('0xabcdef#0x123456');
    });

    it('should preserve Solana address case', async () => {
      const result = await service.getOrCreateUserRequest('SoLaNaToken123', 'SoLaNaUser456');

      expect(result.iaoToken).toBe('SoLaNaToken123');
      expect(result.from).toBe('SoLaNaUser456');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.getOrCreateUserRequest('0xtoken', '0xuser')).rejects.toThrow();
    });
  });

  describe('createRequestQueueEntry', () => {
    it('should create request queue entry and increment totalRequest', async () => {
      const existing: UserRequestDBEntry = {
        id: '0xtoken#0xuser',
        iaoToken: '0xtoken',
        from: '0xuser',
        totalRequest: '5',
        fulfilledRequest: '5',
        refundRequest: '0',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      testData.set('user-requests/0xtoken#0xuser', existing);

      const result = await service.createRequestQueueEntry('0xtoken', '0xuser', '100', '10000');

      expect(result.userRequestNumber).toBe('6');
      expect(result.globalRequestNumber).toBe('100');
      expect(result.fee).toBe('10000');
      expect(result.iaoToken).toBe('0xtoken');
      expect(result.from).toBe('0xuser');
    });

    it('should create user request if not exists', async () => {
      const result = await service.createRequestQueueEntry('0xNewToken', '0xNewUser', '1', '5000');

      expect(result.userRequestNumber).toBe('1');
      expect(result.globalRequestNumber).toBe('1');
    });

    it('should normalize addresses', async () => {
      testData.set('user-requests/0xtoken#0xuser', {
        id: '0xtoken#0xuser',
        iaoToken: '0xtoken',
        from: '0xuser',
        totalRequest: '0',
        fulfilledRequest: '0',
        refundRequest: '0',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await service.createRequestQueueEntry('0xTOKEN', '0xUSER', '1', '1000');

      expect(result.iaoToken).toBe('0xtoken');
      expect(result.from).toBe('0xuser');
    });

    it('should throw on Firestore error', async () => {
      testData.set('user-requests/0xtoken#0xuser', {
        id: '0xtoken#0xuser',
        iaoToken: '0xtoken',
        from: '0xuser',
        totalRequest: '0',
        fulfilledRequest: '0',
        refundRequest: '0',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      shouldThrowError = true;

      await expect(service.createRequestQueueEntry('0xtoken', '0xuser', '1', '1000')).rejects.toThrow();
    });
  });

  describe('scanAllUserRequests', () => {
    it('should return all user requests', async () => {
      testData.set('user-requests/0xtoken1#0xuser1', { id: '0xtoken1#0xuser1', totalRequest: '10' });
      testData.set('user-requests/0xtoken2#0xuser2', { id: '0xtoken2#0xuser2', totalRequest: '20' });

      const result = await service.scanAllUserRequests();

      expect(result).toHaveLength(2);
    });

    it('should return empty array when no requests', async () => {
      const result = await service.scanAllUserRequests();

      expect(result).toEqual([]);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.scanAllUserRequests()).rejects.toThrow();
    });
  });

  describe('scanAllRequestQueue', () => {
    it('should return all request queue entries', async () => {
      testData.set('request-queue/q1', { id: 'q1', fee: '1000' });
      testData.set('request-queue/q2', { id: 'q2', fee: '2000' });

      const result = await service.scanAllRequestQueue();

      expect(result).toHaveLength(2);
    });

    it('should return empty array when no entries', async () => {
      const result = await service.scanAllRequestQueue();

      expect(result).toEqual([]);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.scanAllRequestQueue()).rejects.toThrow();
    });
  });

  describe('getRecentTransactions', () => {
    it('should return recent transactions sorted by createdAt', async () => {
      testData.set('request-queue/q1', { id: 'q1', createdAt: '2024-01-01T00:00:00.000Z' });
      testData.set('request-queue/q2', { id: 'q2', createdAt: '2024-01-02T00:00:00.000Z' });
      testData.set('request-queue/q3', { id: 'q3', createdAt: '2024-01-03T00:00:00.000Z' });

      const result = await service.getRecentTransactions(2);

      expect(result).toHaveLength(2);
      // Should be sorted descending
      expect(result[0].id).toBe('q3');
      expect(result[1].id).toBe('q2');
    });

    it('should use default limit of 20', async () => {
      for (let i = 0; i < 25; i++) {
        testData.set(`request-queue/q${i}`, { id: `q${i}`, createdAt: new Date(2024, 0, i + 1).toISOString() });
      }

      const result = await service.getRecentTransactions();

      expect(result).toHaveLength(20);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.getRecentTransactions()).rejects.toThrow();
    });
  });
});
