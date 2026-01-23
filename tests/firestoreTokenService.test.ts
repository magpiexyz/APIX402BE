/**
 * Tests for Firestore Token Service
 *
 * These tests verify the IAO Token CRUD operations using mocked Firestore.
 * Run with: yarn test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Firestore client before importing the service
vi.mock('../src/db/firestoreClient.js', () => {
  // Create mock document reference
  const createMockDocRef = (data: any) => ({
    get: vi.fn().mockResolvedValue({
      exists: data !== null,
      data: () => data,
    }),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  });

  // Create mock query snapshot
  const createMockSnapshot = (docs: any[]) => ({
    empty: docs.length === 0,
    docs: docs.map((data, index) => ({
      id: data?.id || `doc-${index}`,
      exists: true,
      data: () => data,
    })),
  });

  // Mock collection with chainable methods
  const mockCollection = vi.fn();
  const mockWhere = vi.fn();
  const mockLimit = vi.fn();
  const mockGet = vi.fn();
  const mockDoc = vi.fn();

  // Storage for test data
  let testData: Map<string, any> = new Map();

  const mockFirestore = {
    collection: mockCollection.mockImplementation((collectionName: string) => ({
      doc: mockDoc.mockImplementation((docId: string) => {
        const key = `${collectionName}/${docId}`;
        return {
          get: vi.fn().mockImplementation(async () => {
            const data = testData.get(key);
            return {
              exists: data !== undefined,
              data: () => data,
            };
          }),
          set: vi.fn().mockImplementation(async (data: any) => {
            testData.set(key, data);
          }),
          delete: vi.fn().mockImplementation(async () => {
            testData.delete(key);
          }),
        };
      }),
      where: mockWhere.mockImplementation((field: string, op: string, value: any) => ({
        limit: mockLimit.mockImplementation((n: number) => ({
          get: mockGet.mockImplementation(async () => {
            // Find matching documents
            const matches: any[] = [];
            testData.forEach((data, key) => {
              if (key.startsWith(collectionName) && data[field] === value) {
                matches.push(data);
              }
            });
            return createMockSnapshot(matches.slice(0, n));
          }),
        })),
        get: mockGet.mockImplementation(async () => {
          const matches: any[] = [];
          testData.forEach((data, key) => {
            if (key.startsWith(collectionName) && data[field] === value) {
              matches.push(data);
            }
          });
          return createMockSnapshot(matches);
        }),
      })),
      get: mockGet.mockImplementation(async () => {
        const matches: any[] = [];
        testData.forEach((data, key) => {
          if (key.startsWith(collectionName)) {
            matches.push(data);
          }
        });
        return createMockSnapshot(matches);
      }),
    })),
    // Helper to reset test data (not part of real Firestore)
    _resetTestData: () => {
      testData.clear();
    },
    _setTestData: (key: string, data: any) => {
      testData.set(key, data);
    },
    _getTestData: () => testData,
  };

  return {
    getFirestoreClient: vi.fn(() => mockFirestore),
    Collections: {
      IAO_TOKENS: 'iao-tokens',
      USER_REQUESTS: 'user-requests',
      REQUEST_QUEUE: 'request-queue',
      API_METRICS: 'api-metrics',
      AGENTS: 'agents',
      CHAT_SESSIONS: 'chat-sessions',
      CHAT_MESSAGES: 'chat-messages',
      AGENT_PAYMENTS: 'agent-payments',
      CACHE: 'cache',
      RATE_LIMITS: 'rate-limits',
      CHAIN_CONFIGS: 'chain-configs',
      ALERTS: 'alerts',
      WEBHOOKS: 'webhooks',
    },
    // Export mock for test manipulation
    _mockFirestore: mockFirestore,
  };
});

// Import after mocking
import { DynamoDBService, type IAOTokenDBEntry } from '../src/services/firestoreTokenService.js';
import { getFirestoreClient } from '../src/db/firestoreClient.js';

describe('FirestoreTokenService', () => {
  let service: DynamoDBService;
  let mockFirestore: any;

  // Sample test data
  const sampleToken: IAOTokenDBEntry = {
    id: '0x1234567890abcdef1234567890abcdef12345678',
    slug: 'test-server',
    name: 'Test Server',
    symbol: 'TEST',
    builder: '0xbuilder1234567890abcdef1234567890abcdef',
    paymentToken: '0xusdc1234567890abcdef1234567890abcdef1234',
    chainId: '84532',
    subscriptionCount: '100',
    refundCount: '0',
    fulfilledCount: '100',
    apis: [
      {
        index: 0,
        slug: 'get-data',
        name: 'Get Data API',
        apiUrl: 'https://api.example.com/data',
        description: 'Returns data from the server',
        fee: '10000',
        method: 'GET',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    // Get mock Firestore and reset test data
    mockFirestore = getFirestoreClient() as any;
    mockFirestore._resetTestData();

    // Create service instance
    service = new DynamoDBService('us-west-1', 'apix-iao-tokens');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getItemBySlug', () => {
    it('should return a token when slug exists', async () => {
      // Arrange: Add test token to mock Firestore
      mockFirestore._setTestData('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      // Act: Query by slug
      const result = await service.getItemBySlug('test-server');

      // Assert: Should return the token
      expect(result).not.toBeNull();
      expect(result?.slug).toBe('test-server');
      expect(result?.name).toBe('Test Server');
      expect(result?.apis).toHaveLength(1);
      expect(result?.apis[0].slug).toBe('get-data');
    });

    it('should return null when slug does not exist', async () => {
      // Arrange: No data in mock

      // Act: Query for non-existent slug
      const result = await service.getItemBySlug('non-existent');

      // Assert: Should return null
      expect(result).toBeNull();
    });

    it('should normalize slug to lowercase', async () => {
      // Arrange: Add token with lowercase slug
      mockFirestore._setTestData('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      // Act: Query with uppercase slug
      const result = await service.getItemBySlug('TEST-SERVER');

      // Assert: Should still find the token (slug normalized to lowercase)
      expect(result).not.toBeNull();
      expect(result?.slug).toBe('test-server');
    });
  });

  describe('slugExists', () => {
    it('should return true when slug exists', async () => {
      // Arrange
      mockFirestore._setTestData('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      // Act
      const exists = await service.slugExists('test-server');

      // Assert
      expect(exists).toBe(true);
    });

    it('should return false when slug does not exist', async () => {
      // Arrange: No data

      // Act
      const exists = await service.slugExists('non-existent');

      // Assert
      expect(exists).toBe(false);
    });
  });

  describe('getApiBySlug', () => {
    it('should return API entry when it exists in token', () => {
      // Act
      const api = service.getApiBySlug(sampleToken, 'get-data');

      // Assert
      expect(api).not.toBeNull();
      expect(api?.slug).toBe('get-data');
      expect(api?.name).toBe('Get Data API');
      expect(api?.fee).toBe('10000');
    });

    it('should return null when API slug does not exist', () => {
      // Act
      const api = service.getApiBySlug(sampleToken, 'non-existent-api');

      // Assert
      expect(api).toBeNull();
    });

    it('should normalize API slug to lowercase', () => {
      // Act
      const api = service.getApiBySlug(sampleToken, 'GET-DATA');

      // Assert
      expect(api).not.toBeNull();
      expect(api?.slug).toBe('get-data');
    });

    it('should return null for token with no APIs', () => {
      // Arrange
      const tokenWithoutApis: IAOTokenDBEntry = {
        ...sampleToken,
        apis: [],
      };

      // Act
      const api = service.getApiBySlug(tokenWithoutApis, 'get-data');

      // Assert
      expect(api).toBeNull();
    });
  });

  describe('getApiByIndex', () => {
    it('should return API entry by index', () => {
      // Act
      const api = service.getApiByIndex(sampleToken, 0);

      // Assert
      expect(api).not.toBeNull();
      expect(api?.index).toBe(0);
      expect(api?.slug).toBe('get-data');
    });

    it('should return null for invalid index', () => {
      // Act
      const api = service.getApiByIndex(sampleToken, 999);

      // Assert
      expect(api).toBeNull();
    });
  });
});
