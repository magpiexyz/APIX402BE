/**
 * Tests for Firestore Token Service
 *
 * Comprehensive tests for IAO Token CRUD operations.
 * Run with: yarn test
 * Coverage: yarn test:coverage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Storage for test data (shared across mock)
let testData: Map<string, any> = new Map();
let shouldThrowError = false;
let errorMessage = 'Firestore error';

// Mock the Firestore client before importing the service
vi.mock('../src/db/firestoreClient.js', () => {
  // Create mock query snapshot
  const createMockSnapshot = (docs: any[]) => ({
    empty: docs.length === 0,
    docs: docs.map((data, index) => ({
      id: data?.id || `doc-${index}`,
      exists: true,
      data: () => data,
    })),
  });

  const mockFirestore = {
    collection: vi.fn().mockImplementation((collectionName: string) => ({
      doc: vi.fn().mockImplementation((docId: string) => {
        const key = `${collectionName}/${docId}`;
        return {
          get: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) {
              throw new Error(errorMessage);
            }
            const data = testData.get(key);
            return {
              exists: data !== undefined,
              data: () => data,
            };
          }),
          set: vi.fn().mockImplementation(async (data: any) => {
            if (shouldThrowError) {
              throw new Error(errorMessage);
            }
            testData.set(key, data);
          }),
          delete: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) {
              throw new Error(errorMessage);
            }
            testData.delete(key);
          }),
        };
      }),
      where: vi.fn().mockImplementation((field: string, _op: string, value: any) => ({
        limit: vi.fn().mockImplementation((n: number) => ({
          get: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) {
              throw new Error(errorMessage);
            }
            const matches: any[] = [];
            testData.forEach((data, key) => {
              if (key.startsWith(collectionName) && data[field] === value) {
                matches.push(data);
              }
            });
            return createMockSnapshot(matches.slice(0, n));
          }),
        })),
        get: vi.fn().mockImplementation(async () => {
          if (shouldThrowError) {
            throw new Error(errorMessage);
          }
          const matches: any[] = [];
          testData.forEach((data, key) => {
            if (key.startsWith(collectionName) && data[field] === value) {
              matches.push(data);
            }
          });
          return createMockSnapshot(matches);
        }),
      })),
      get: vi.fn().mockImplementation(async () => {
        if (shouldThrowError) {
          throw new Error(errorMessage);
        }
        const matches: any[] = [];
        testData.forEach((data, key) => {
          if (key.startsWith(collectionName)) {
            matches.push(data);
          }
        });
        return createMockSnapshot(matches);
      }),
    })),
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
  };
});

// Import after mocking
import { TokenService, type IAOTokenDBEntry, type ApiEntry } from '../src/services/firestoreTokenService.js';

describe('FirestoreTokenService', () => {
  let service: TokenService;

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

  const sampleToken2: IAOTokenDBEntry = {
    id: '0xabcdef1234567890abcdef1234567890abcdef12',
    slug: 'another-server',
    name: 'Another Server',
    symbol: 'ANO',
    builder: '0xbuilder1234567890abcdef1234567890abcdef',
    paymentToken: '0xusdc1234567890abcdef1234567890abcdef1234',
    chainId: '84532',
    subscriptionCount: '50',
    refundCount: '0',
    fulfilledCount: '50',
    apis: [
      {
        index: 0,
        slug: 'post-data',
        name: 'Post Data API',
        apiUrl: 'https://api.another.com/data',
        description: 'Posts data to the server',
        fee: '20000',
        method: 'POST',
        createdAt: '2024-01-02T00:00:00.000Z',
      },
    ],
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };

  // Solana token (non-0x address)
  const solanaToken: IAOTokenDBEntry = {
    id: 'So11111111111111111111111111111111111111112',
    slug: 'solana-server',
    name: 'Solana Server',
    symbol: 'SOL',
    builder: 'SoLaNA1111111111111111111111111111111111111',
    paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    chainId: 'devnet',
    subscriptionCount: '25',
    refundCount: '0',
    fulfilledCount: '25',
    apis: [],
    createdAt: '2024-01-03T00:00:00.000Z',
    updatedAt: '2024-01-03T00:00:00.000Z',
  };

  beforeEach(() => {
    // Reset test data and error state
    testData.clear();
    shouldThrowError = false;
    errorMessage = 'Firestore error';

    // Create service instance
    service = new TokenService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // putItem Tests
  // ============================================
  describe('putItem', () => {
    it('should store a token successfully', async () => {
      await service.putItem(sampleToken);

      const stored = testData.get('iao-tokens/0x1234567890abcdef1234567890abcdef12345678');
      expect(stored).toBeDefined();
      expect(stored.slug).toBe('test-server');
      expect(stored.name).toBe('Test Server');
    });

    it('should overwrite existing token with same id', async () => {
      await service.putItem(sampleToken);

      const updatedToken = { ...sampleToken, name: 'Updated Server' };
      await service.putItem(updatedToken);

      const stored = testData.get('iao-tokens/0x1234567890abcdef1234567890abcdef12345678');
      expect(stored.name).toBe('Updated Server');
    });

    it('should throw error on Firestore failure', async () => {
      shouldThrowError = true;
      errorMessage = 'Write failed';

      await expect(service.putItem(sampleToken)).rejects.toThrow('Write failed');
    });
  });

  // ============================================
  // getItem Tests
  // ============================================
  describe('getItem', () => {
    it('should return token when it exists', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const result = await service.getItem('0x1234567890abcdef1234567890abcdef12345678');

      expect(result).not.toBeNull();
      expect(result?.slug).toBe('test-server');
    });

    it('should return null when token does not exist', async () => {
      const result = await service.getItem('0xnonexistent');

      expect(result).toBeNull();
    });

    it('should normalize EVM address to lowercase', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      // Query with uppercase
      const result = await service.getItem('0x1234567890ABCDEF1234567890ABCDEF12345678');

      expect(result).not.toBeNull();
      expect(result?.slug).toBe('test-server');
    });

    it('should preserve Solana address case', async () => {
      testData.set('iao-tokens/So11111111111111111111111111111111111111112', solanaToken);

      const result = await service.getItem('So11111111111111111111111111111111111111112');

      expect(result).not.toBeNull();
      expect(result?.slug).toBe('solana-server');
    });

    it('should return null on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getItem('0x1234567890abcdef1234567890abcdef12345678');

      expect(result).toBeNull();
    });
  });

  // ============================================
  // deleteItem Tests
  // ============================================
  describe('deleteItem', () => {
    it('should delete an existing token', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      await service.deleteItem('0x1234567890abcdef1234567890abcdef12345678');

      expect(testData.has('iao-tokens/0x1234567890abcdef1234567890abcdef12345678')).toBe(false);
    });

    it('should normalize EVM address for deletion', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      // Delete with uppercase
      await service.deleteItem('0x1234567890ABCDEF1234567890ABCDEF12345678');

      expect(testData.has('iao-tokens/0x1234567890abcdef1234567890abcdef12345678')).toBe(false);
    });

    it('should not throw when deleting non-existent token', async () => {
      await expect(service.deleteItem('0xnonexistent')).resolves.not.toThrow();
    });

    it('should throw error on Firestore failure', async () => {
      shouldThrowError = true;
      errorMessage = 'Delete failed';

      await expect(service.deleteItem('0x123')).rejects.toThrow('Delete failed');
    });
  });

  // ============================================
  // scanAllItems Tests
  // ============================================
  describe('scanAllItems', () => {
    it('should return all tokens', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);
      testData.set('iao-tokens/0xabcdef1234567890abcdef1234567890abcdef12', sampleToken2);

      const results = await service.scanAllItems();

      expect(results).toHaveLength(2);
      expect(results.map(t => t.slug)).toContain('test-server');
      expect(results.map(t => t.slug)).toContain('another-server');
    });

    it('should return empty array when no tokens exist', async () => {
      const results = await service.scanAllItems();

      expect(results).toEqual([]);
    });

    it('should throw error on Firestore failure', async () => {
      shouldThrowError = true;

      await expect(service.scanAllItems()).rejects.toThrow();
    });
  });

  // ============================================
  // scanItemsByBuilder Tests
  // ============================================
  describe('scanItemsByBuilder', () => {
    it('should return tokens for a specific builder', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);
      testData.set('iao-tokens/0xabcdef1234567890abcdef1234567890abcdef12', sampleToken2);

      const results = await service.scanItemsByBuilder('0xbuilder1234567890abcdef1234567890abcdef');

      expect(results).toHaveLength(2);
    });

    it('should return empty array when builder has no tokens', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const results = await service.scanItemsByBuilder('0xdifferentbuilder');

      expect(results).toEqual([]);
    });

    it('should normalize builder address to lowercase for EVM', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      // Query with uppercase
      const results = await service.scanItemsByBuilder('0xBUILDER1234567890ABCDEF1234567890ABCDEF');

      expect(results).toHaveLength(1);
    });

    it('should throw error on Firestore failure', async () => {
      shouldThrowError = true;

      await expect(service.scanItemsByBuilder('0xbuilder')).rejects.toThrow();
    });
  });

  // ============================================
  // getItemBySlug Tests
  // ============================================
  describe('getItemBySlug', () => {
    it('should return a token when slug exists', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const result = await service.getItemBySlug('test-server');

      expect(result).not.toBeNull();
      expect(result?.slug).toBe('test-server');
      expect(result?.name).toBe('Test Server');
      expect(result?.apis).toHaveLength(1);
    });

    it('should return null when slug does not exist', async () => {
      const result = await service.getItemBySlug('non-existent');

      expect(result).toBeNull();
    });

    it('should normalize slug to lowercase', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const result = await service.getItemBySlug('TEST-SERVER');

      expect(result).not.toBeNull();
      expect(result?.slug).toBe('test-server');
    });

    it('should return null on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getItemBySlug('test-server');

      expect(result).toBeNull();
    });
  });

  // ============================================
  // slugExists Tests
  // ============================================
  describe('slugExists', () => {
    it('should return true when slug exists', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const exists = await service.slugExists('test-server');

      expect(exists).toBe(true);
    });

    it('should return false when slug does not exist', async () => {
      const exists = await service.slugExists('non-existent');

      expect(exists).toBe(false);
    });
  });

  // ============================================
  // apiUrlExists Tests
  // ============================================
  describe('apiUrlExists', () => {
    it('should return exists: true when URL and method match', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const result = await service.apiUrlExists('https://api.example.com/data', 'GET');

      expect(result.exists).toBe(true);
      expect(result.serverSlug).toBe('test-server');
      expect(result.tokenAddress).toBe('0x1234567890abcdef1234567890abcdef12345678');
    });

    it('should return exists: false when URL exists but method differs', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      // Same URL but POST instead of GET
      const result = await service.apiUrlExists('https://api.example.com/data', 'POST');

      expect(result.exists).toBe(false);
    });

    it('should return exists: false when URL does not exist', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const result = await service.apiUrlExists('https://api.different.com/data', 'GET');

      expect(result.exists).toBe(false);
    });

    it('should default method to GET when not specified in API entry', async () => {
      const tokenWithNoMethod: IAOTokenDBEntry = {
        ...sampleToken,
        apis: [{
          index: 0,
          slug: 'no-method',
          name: 'No Method API',
          apiUrl: 'https://api.nomethod.com/data',
          description: 'No method specified',
          fee: '10000',
          createdAt: '2024-01-01T00:00:00.000Z',
        }],
      };
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', tokenWithNoMethod);

      const result = await service.apiUrlExists('https://api.nomethod.com/data', 'GET');

      expect(result.exists).toBe(true);
    });

    it('should return exists: false on error', async () => {
      shouldThrowError = true;

      const result = await service.apiUrlExists('https://api.example.com/data', 'GET');

      expect(result.exists).toBe(false);
    });

    it('should handle tokens with no apis array', async () => {
      const tokenNoApis = { ...sampleToken, apis: undefined as any };
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', tokenNoApis);

      const result = await service.apiUrlExists('https://api.example.com/data', 'GET');

      expect(result.exists).toBe(false);
    });
  });

  // ============================================
  // checkApiUrlsDuplicate Tests
  // ============================================
  describe('checkApiUrlsDuplicate', () => {
    it('should return duplicates when URLs and methods match', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const duplicates = await service.checkApiUrlsDuplicate([
        { url: 'https://api.example.com/data', method: 'GET' },
      ]);

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].url).toBe('https://api.example.com/data');
      expect(duplicates[0].method).toBe('GET');
      expect(duplicates[0].serverSlug).toBe('test-server');
    });

    it('should return empty array when no duplicates exist', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const duplicates = await service.checkApiUrlsDuplicate([
        { url: 'https://api.new.com/data', method: 'GET' },
      ]);

      expect(duplicates).toEqual([]);
    });

    it('should allow same URL with different method', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const duplicates = await service.checkApiUrlsDuplicate([
        { url: 'https://api.example.com/data', method: 'POST' },
      ]);

      expect(duplicates).toEqual([]);
    });

    it('should check multiple APIs at once', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);
      testData.set('iao-tokens/0xabcdef1234567890abcdef1234567890abcdef12', sampleToken2);

      const duplicates = await service.checkApiUrlsDuplicate([
        { url: 'https://api.example.com/data', method: 'GET' },
        { url: 'https://api.another.com/data', method: 'POST' },
        { url: 'https://api.new.com/data', method: 'GET' },
      ]);

      expect(duplicates).toHaveLength(2);
    });

    it('should return empty array on error', async () => {
      shouldThrowError = true;

      const duplicates = await service.checkApiUrlsDuplicate([
        { url: 'https://api.example.com/data', method: 'GET' },
      ]);

      expect(duplicates).toEqual([]);
    });
  });

  // ============================================
  // addApiToToken Tests
  // ============================================
  describe('addApiToToken', () => {
    it('should add a new API to existing token', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const newApi = await service.addApiToToken(
        '0x1234567890abcdef1234567890abcdef12345678',
        'new-api',
        'New API',
        'https://api.example.com/new',
        'A new API endpoint',
        '15000',
        'POST'
      );

      expect(newApi).not.toBeNull();
      expect(newApi?.slug).toBe('new-api');
      expect(newApi?.index).toBe(1);
      expect(newApi?.method).toBe('POST');

      // Verify token was updated
      const updated = testData.get('iao-tokens/0x1234567890abcdef1234567890abcdef12345678');
      expect(updated.apis).toHaveLength(2);
    });

    it('should return null when token does not exist', async () => {
      const newApi = await service.addApiToToken(
        '0xnonexistent',
        'new-api',
        'New API',
        'https://api.example.com/new',
        'A new API endpoint',
        '15000'
      );

      expect(newApi).toBeNull();
    });

    it('should return null when API slug already exists in token', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const newApi = await service.addApiToToken(
        '0x1234567890abcdef1234567890abcdef12345678',
        'get-data', // Already exists
        'Duplicate API',
        'https://api.example.com/duplicate',
        'Duplicate API',
        '15000'
      );

      expect(newApi).toBeNull();
    });

    it('should normalize API slug to lowercase', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const newApi = await service.addApiToToken(
        '0x1234567890abcdef1234567890abcdef12345678',
        'NEW-API-UPPERCASE',
        'New API',
        'https://api.example.com/new',
        'A new API endpoint',
        '15000'
      );

      expect(newApi?.slug).toBe('new-api-uppercase');
    });

    it('should default method to GET', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const newApi = await service.addApiToToken(
        '0x1234567890abcdef1234567890abcdef12345678',
        'default-method',
        'Default Method API',
        'https://api.example.com/default',
        'Uses default GET method',
        '15000'
      );

      expect(newApi?.method).toBe('GET');
    });

    it('should initialize apis array if undefined', async () => {
      const tokenNoApis = { ...sampleToken, apis: undefined as any };
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', tokenNoApis);

      const newApi = await service.addApiToToken(
        '0x1234567890abcdef1234567890abcdef12345678',
        'first-api',
        'First API',
        'https://api.example.com/first',
        'First API on this token',
        '10000'
      );

      expect(newApi).not.toBeNull();
      expect(newApi?.index).toBe(0);
    });

    it('should set createdAt timestamp', async () => {
      testData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', sampleToken);

      const before = new Date().toISOString();
      const newApi = await service.addApiToToken(
        '0x1234567890abcdef1234567890abcdef12345678',
        'timestamped-api',
        'Timestamped API',
        'https://api.example.com/timestamped',
        'Has timestamp',
        '10000'
      );
      const after = new Date().toISOString();

      expect(newApi?.createdAt).toBeDefined();
      expect(newApi!.createdAt >= before).toBe(true);
      expect(newApi!.createdAt <= after).toBe(true);
    });
  });

  // ============================================
  // getApiBySlug Tests
  // ============================================
  describe('getApiBySlug', () => {
    it('should return API entry when it exists in token', () => {
      const api = service.getApiBySlug(sampleToken, 'get-data');

      expect(api).not.toBeNull();
      expect(api?.slug).toBe('get-data');
      expect(api?.name).toBe('Get Data API');
      expect(api?.fee).toBe('10000');
    });

    it('should return null when API slug does not exist', () => {
      const api = service.getApiBySlug(sampleToken, 'non-existent-api');

      expect(api).toBeNull();
    });

    it('should normalize API slug to lowercase', () => {
      const api = service.getApiBySlug(sampleToken, 'GET-DATA');

      expect(api).not.toBeNull();
      expect(api?.slug).toBe('get-data');
    });

    it('should return null for token with empty apis array', () => {
      const tokenWithoutApis: IAOTokenDBEntry = {
        ...sampleToken,
        apis: [],
      };

      const api = service.getApiBySlug(tokenWithoutApis, 'get-data');

      expect(api).toBeNull();
    });

    it('should return null for token with undefined apis', () => {
      const tokenUndefinedApis = { ...sampleToken, apis: undefined as any };

      const api = service.getApiBySlug(tokenUndefinedApis, 'get-data');

      expect(api).toBeNull();
    });
  });

  // ============================================
  // getApiByIndex Tests
  // ============================================
  describe('getApiByIndex', () => {
    it('should return API entry by index', () => {
      const api = service.getApiByIndex(sampleToken, 0);

      expect(api).not.toBeNull();
      expect(api?.index).toBe(0);
      expect(api?.slug).toBe('get-data');
    });

    it('should return null for invalid index', () => {
      const api = service.getApiByIndex(sampleToken, 999);

      expect(api).toBeNull();
    });

    it('should return null for negative index', () => {
      const api = service.getApiByIndex(sampleToken, -1);

      expect(api).toBeNull();
    });

    it('should return null for token with empty apis array', () => {
      const tokenWithoutApis: IAOTokenDBEntry = {
        ...sampleToken,
        apis: [],
      };

      const api = service.getApiByIndex(tokenWithoutApis, 0);

      expect(api).toBeNull();
    });

    it('should return null for token with undefined apis', () => {
      const tokenUndefinedApis = { ...sampleToken, apis: undefined as any };

      const api = service.getApiByIndex(tokenUndefinedApis, 0);

      expect(api).toBeNull();
    });

    it('should find correct API when multiple exist', () => {
      const tokenMultipleApis: IAOTokenDBEntry = {
        ...sampleToken,
        apis: [
          { ...sampleToken.apis[0], index: 0 },
          { ...sampleToken.apis[0], index: 1, slug: 'second-api' },
          { ...sampleToken.apis[0], index: 2, slug: 'third-api' },
        ],
      };

      const api = service.getApiByIndex(tokenMultipleApis, 1);

      expect(api?.slug).toBe('second-api');
    });
  });

  // ============================================
  // Address Normalization Tests
  // ============================================
  describe('Address Normalization', () => {
    it('should lowercase EVM addresses (0x prefix)', async () => {
      testData.set('iao-tokens/0xabcdef', { ...sampleToken, id: '0xabcdef' });

      const result = await service.getItem('0xABCDEF');

      expect(result).not.toBeNull();
    });

    it('should preserve Solana address case (no 0x prefix)', async () => {
      testData.set('iao-tokens/SoLaNaAdDrEsS123', { ...solanaToken, id: 'SoLaNaAdDrEsS123' });

      // Solana addresses are case-sensitive
      const result = await service.getItem('SoLaNaAdDrEsS123');
      expect(result).not.toBeNull();
    });
  });
});
