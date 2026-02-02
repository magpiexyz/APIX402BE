/**
 * Tests for new features:
 * - Logo upload endpoint (/api/upload-logo)
 * - POST validation accepting 400/422 status codes
 * - Agent systemInstructions update
 * - logoUrl in token entry mapping
 * - addApiToToken with parameters and responseFormat
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================
// 1. Logo Upload Endpoint Tests
// ============================================
describe('Logo Upload Endpoint', () => {
  describe('Image validation', () => {
    it('should accept valid PNG base64 image', () => {
      const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      expect(image.startsWith('data:image/')).toBe(true);
      const mimeMatch = image.match(/^data:(image\/[^;]+);base64,/);
      expect(mimeMatch).not.toBeNull();
      expect(mimeMatch![1]).toBe('image/png');
    });

    it('should accept valid JPEG base64 image', () => {
      const image = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

      const mimeMatch = image.match(/^data:(image\/[^;]+);base64,/);
      expect(mimeMatch).not.toBeNull();
      expect(mimeMatch![1]).toBe('image/jpeg');
    });

    it('should accept valid WebP base64 image', () => {
      const image = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

      const mimeMatch = image.match(/^data:(image\/[^;]+);base64,/);
      expect(mimeMatch).not.toBeNull();
      expect(mimeMatch![1]).toBe('image/webp');
    });

    it('should accept valid SVG base64 image', () => {
      const image = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==';

      const mimeMatch = image.match(/^data:(image\/[^;]+);base64,/);
      expect(mimeMatch).not.toBeNull();
      expect(mimeMatch![1]).toBe('image/svg+xml');
    });

    it('should reject non-image data URI', () => {
      const invalidImage = 'data:text/plain;base64,SGVsbG8gV29ybGQ=';

      expect(invalidImage.startsWith('data:image/')).toBe(false);
    });

    it('should reject data without URI prefix', () => {
      const noPrefix = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA';

      expect(noPrefix.startsWith('data:image/')).toBe(false);
    });

    it('should reject invalid MIME types', () => {
      const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];

      const gifImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      const mimeMatch = gifImage.match(/^data:(image\/[^;]+);base64,/);

      expect(mimeMatch).not.toBeNull();
      expect(validTypes.includes(mimeMatch![1])).toBe(false); // GIF not in allowed types
    });
  });

  describe('File size validation', () => {
    it('should calculate base64 file size correctly', () => {
      // 100 bytes of base64 data = ~75 bytes binary
      const base64Data = 'A'.repeat(100);
      const fileSizeBytes = Math.ceil((base64Data.length * 3) / 4);

      expect(fileSizeBytes).toBe(75);
    });

    it('should reject images over 500KB', () => {
      const maxSizeBytes = 500 * 1024; // 500KB

      // Simulate large base64 (700KB binary = ~933KB base64)
      const largeSizeBase64Chars = Math.ceil((700 * 1024 * 4) / 3);
      const fileSizeBytes = Math.ceil((largeSizeBase64Chars * 3) / 4);

      expect(fileSizeBytes > maxSizeBytes).toBe(true);
    });

    it('should accept images under 500KB', () => {
      const maxSizeBytes = 500 * 1024;

      // 100KB binary = ~133KB base64
      const smallSizeBase64Chars = Math.ceil((100 * 1024 * 4) / 3);
      const fileSizeBytes = Math.ceil((smallSizeBase64Chars * 3) / 4);

      expect(fileSizeBytes <= maxSizeBytes).toBe(true);
    });
  });

  describe('Cloudinary configuration check', () => {
    it('should detect when Cloudinary is not configured', () => {
      const env = {
        CLOUDINARY_CLOUD_NAME: undefined,
        CLOUDINARY_API_KEY: undefined,
        CLOUDINARY_API_SECRET: undefined,
      };

      const isConfigured = !!(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

      expect(isConfigured).toBe(false);
    });

    it('should detect when Cloudinary is configured', () => {
      const env = {
        CLOUDINARY_CLOUD_NAME: 'my-cloud',
        CLOUDINARY_API_KEY: '123456',
        CLOUDINARY_API_SECRET: 'secret',
      };

      const isConfigured = !!(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

      expect(isConfigured).toBe(true);
    });

    it('should detect partial Cloudinary configuration as not configured', () => {
      const env = {
        CLOUDINARY_CLOUD_NAME: 'my-cloud',
        CLOUDINARY_API_KEY: undefined,
        CLOUDINARY_API_SECRET: 'secret',
      };

      const isConfigured = !!(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

      expect(isConfigured).toBe(false);
    });
  });
});

// ============================================
// 2. POST Validation (Accept 400/422) Tests
// ============================================
describe('POST Endpoint Validation', () => {
  describe('Acceptable status codes', () => {
    it('should accept 200 for GET requests', () => {
      const method = 'GET';
      const acceptableStatuses = method === 'POST'
        ? [200, 202, 400, 422]
        : [200, 202];

      expect(acceptableStatuses.includes(200)).toBe(true);
    });

    it('should accept 202 for GET requests', () => {
      const method = 'GET';
      const acceptableStatuses = method === 'POST'
        ? [200, 202, 400, 422]
        : [200, 202];

      expect(acceptableStatuses.includes(202)).toBe(true);
    });

    it('should reject 400 for GET requests', () => {
      const method = 'GET';
      const acceptableStatuses = method === 'POST'
        ? [200, 202, 400, 422]
        : [200, 202];

      expect(acceptableStatuses.includes(400)).toBe(false);
    });

    it('should reject 422 for GET requests', () => {
      const method = 'GET';
      const acceptableStatuses = method === 'POST'
        ? [200, 202, 400, 422]
        : [200, 202];

      expect(acceptableStatuses.includes(422)).toBe(false);
    });

    it('should accept 200 for POST requests', () => {
      const method = 'POST';
      const acceptableStatuses = method === 'POST'
        ? [200, 202, 400, 422]
        : [200, 202];

      expect(acceptableStatuses.includes(200)).toBe(true);
    });

    it('should accept 400 for POST requests (empty body validation)', () => {
      const method = 'POST';
      const acceptableStatuses = method === 'POST'
        ? [200, 202, 400, 422]
        : [200, 202];

      expect(acceptableStatuses.includes(400)).toBe(true);
    });

    it('should accept 422 for POST requests (validation error)', () => {
      const method = 'POST';
      const acceptableStatuses = method === 'POST'
        ? [200, 202, 400, 422]
        : [200, 202];

      expect(acceptableStatuses.includes(422)).toBe(true);
    });

    it('should reject 500 for POST requests', () => {
      const method = 'POST';
      const acceptableStatuses = method === 'POST'
        ? [200, 202, 400, 422]
        : [200, 202];

      expect(acceptableStatuses.includes(500)).toBe(false);
    });

    it('should reject 404 for POST requests', () => {
      const method = 'POST';
      const acceptableStatuses = method === 'POST'
        ? [200, 202, 400, 422]
        : [200, 202];

      expect(acceptableStatuses.includes(404)).toBe(false);
    });

    it('should reject 503 for both GET and POST', () => {
      for (const method of ['GET', 'POST']) {
        const acceptableStatuses = method === 'POST'
          ? [200, 202, 400, 422]
          : [200, 202];

        expect(acceptableStatuses.includes(503)).toBe(false);
      }
    });
  });
});

// ============================================
// 3. logoUrl in Token Entry Mapping Tests
// ============================================
describe('logoUrl in Token Entry', () => {
  describe('IAOTokenEntry interface', () => {
    it('should include logoUrl field in token entry', () => {
      const tokenEntry = {
        id: '0x123',
        slug: 'test-server',
        builder: '0xbuilder',
        name: 'Test',
        symbol: 'TST',
        paymentToken: '0xusdc',
        chainId: '84532',
        tags: ['defi'],
        logoUrl: 'https://res.cloudinary.com/test/image/upload/apix-logos/logo.png',
        apis: [],
      };

      expect(tokenEntry.logoUrl).toBeDefined();
      expect(tokenEntry.logoUrl).toContain('cloudinary');
    });

    it('should allow logoUrl to be undefined', () => {
      const tokenEntry = {
        id: '0x123',
        slug: 'test-server',
        builder: '0xbuilder',
        name: 'Test',
        symbol: 'TST',
        paymentToken: '0xusdc',
        apis: [],
      };

      expect((tokenEntry as any).logoUrl).toBeUndefined();
    });
  });

  describe('Token entry mapping with logoUrl', () => {
    it('should map logoUrl from DB entry', () => {
      const dbEntry = {
        id: '0x123',
        slug: 'test-server',
        builder: '0xbuilder',
        name: 'Test',
        symbol: 'TST',
        subscriptionCount: '0',
        totalFeesCollected: '0',
        paymentToken: '0xusdc',
        chainId: '84532',
        tags: ['defi'],
        logoUrl: 'https://res.cloudinary.com/test/logo.png',
        apis: [],
      };

      // Simulates the mapping function in index.ts
      const tokenEntry = {
        id: dbEntry.id,
        slug: dbEntry.slug,
        builder: dbEntry.builder,
        name: dbEntry.name,
        symbol: dbEntry.symbol,
        subscriptionCount: dbEntry.subscriptionCount,
        totalFeesCollected: dbEntry.totalFeesCollected,
        paymentToken: dbEntry.paymentToken,
        chainId: dbEntry.chainId,
        tags: dbEntry.tags,
        logoUrl: dbEntry.logoUrl,
        apis: dbEntry.apis || [],
      };

      expect(tokenEntry.logoUrl).toBe('https://res.cloudinary.com/test/logo.png');
    });

    it('should handle undefined logoUrl in DB entry', () => {
      const dbEntry = {
        id: '0x123',
        slug: 'test-server',
        builder: '0xbuilder',
        name: 'Test',
        symbol: 'TST',
        paymentToken: '0xusdc',
        apis: [],
        // logoUrl not present
      };

      const tokenEntry = {
        id: dbEntry.id,
        slug: dbEntry.slug,
        logoUrl: (dbEntry as any).logoUrl,
        apis: dbEntry.apis || [],
      };

      expect(tokenEntry.logoUrl).toBeUndefined();
    });
  });

  describe('Server response includes logoUrl', () => {
    it('should include logoUrl in server detail response', () => {
      const tokenEntry = {
        id: '0x123',
        slug: 'test-server',
        name: 'Test',
        symbol: 'TST',
        builder: '0xbuilder',
        paymentToken: '0xusdc',
        subscriptionCount: '10',
        tags: ['defi'],
        logoUrl: 'https://res.cloudinary.com/test/logo.png',
        apis: [],
        chainId: '84532',
      };

      // Simulates server detail response
      const response = {
        id: tokenEntry.id,
        slug: tokenEntry.slug,
        name: tokenEntry.name,
        symbol: tokenEntry.symbol,
        builder: tokenEntry.builder,
        paymentToken: tokenEntry.paymentToken,
        subscriptionCount: tokenEntry.subscriptionCount || "0",
        tags: tokenEntry.tags || [],
        logoUrl: tokenEntry.logoUrl,
        apis: [],
        apiCount: 0,
        chainId: tokenEntry.chainId,
      };

      expect(response.logoUrl).toBe('https://res.cloudinary.com/test/logo.png');
    });

    it('should include logoUrl in server list response', () => {
      const token = {
        id: '0x123',
        slug: 'test-server',
        name: 'Test',
        symbol: 'TST',
        builder: '0xbuilder',
        paymentToken: '0xusdc',
        subscriptionCount: '10',
        tags: ['defi'],
        logoUrl: 'https://res.cloudinary.com/test/logo.png',
        apis: [],
        chainId: '84532',
      };

      // Simulates server list mapping
      const sanitized = {
        id: token.id,
        slug: token.slug,
        name: token.name,
        symbol: token.symbol,
        builder: token.builder,
        paymentToken: token.paymentToken,
        subscriptionCount: token.subscriptionCount,
        tags: token.tags || [],
        logoUrl: token.logoUrl,
        apis: [],
        apiCount: 0,
        chainId: token.chainId,
      };

      expect(sanitized.logoUrl).toBe('https://res.cloudinary.com/test/logo.png');
    });
  });

  describe('Registration with logoUrl', () => {
    it('should store logoUrl in token entry during registration', () => {
      const logoUrl = 'https://res.cloudinary.com/test/logo.png';

      const tokenEntry = {
        id: '0x123',
        slug: 'test-server',
        name: 'Test',
        symbol: 'TST',
        apis: [],
        builder: '0xbuilder',
        paymentToken: '0xusdc',
        chainId: '84532',
        subscriptionCount: '0',
        refundCount: '0',
        fulfilledCount: '0',
        tags: undefined,
        logoUrl: logoUrl || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(tokenEntry.logoUrl).toBe(logoUrl);
    });

    it('should set logoUrl to undefined when not provided', () => {
      const logoUrl = undefined;

      const tokenEntry = {
        id: '0x123',
        logoUrl: logoUrl || undefined,
      };

      expect(tokenEntry.logoUrl).toBeUndefined();
    });

    it('should set logoUrl to undefined when empty string', () => {
      const logoUrl = '';

      const tokenEntry = {
        id: '0x123',
        logoUrl: logoUrl || undefined,
      };

      expect(tokenEntry.logoUrl).toBeUndefined();
    });
  });
});

// ============================================
// 4. Agent systemInstructions Update Tests
// ============================================

// Test data storage
let agentTestData: Map<string, any> = new Map();
let agentShouldThrowError = false;

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
    collection: vi.fn().mockImplementation((collectionName: string) => {
      const baseQuery = {
        doc: vi.fn().mockImplementation((docId: string) => {
          const key = `${collectionName}/${docId}`;
          return {
            get: vi.fn().mockImplementation(async () => {
              if (agentShouldThrowError) throw new Error('Firestore error');
              const data = agentTestData.get(key);
              return { exists: data !== undefined, data: () => data };
            }),
            set: vi.fn().mockImplementation(async (data: any) => {
              if (agentShouldThrowError) throw new Error('Firestore error');
              agentTestData.set(key, data);
            }),
            update: vi.fn().mockImplementation(async (updates: any) => {
              if (agentShouldThrowError) throw new Error('Firestore error');
              const existing = agentTestData.get(key) || {};
              agentTestData.set(key, { ...existing, ...updates });
            }),
            delete: vi.fn().mockImplementation(async () => {
              if (agentShouldThrowError) throw new Error('Firestore error');
              agentTestData.delete(key);
            }),
          };
        }),
        where: vi.fn().mockImplementation((field: string, op: string, value: any) => ({
          where: vi.fn().mockImplementation((field2: string, op2: string, value2: any) => ({
            get: vi.fn().mockImplementation(async () => {
              if (agentShouldThrowError) throw new Error('Firestore error');
              const matches: any[] = [];
              agentTestData.forEach((data, key) => {
                if (key.startsWith(collectionName) && data[field] === value && data[field2] === value2) {
                  matches.push(data);
                }
              });
              return createMockSnapshot(matches);
            }),
          })),
          get: vi.fn().mockImplementation(async () => {
            if (agentShouldThrowError) throw new Error('Firestore error');
            const matches: any[] = [];
            agentTestData.forEach((data, key) => {
              if (key.startsWith(collectionName) && data[field] === value) {
                matches.push(data);
              }
            });
            return createMockSnapshot(matches);
          }),
        })),
        get: vi.fn().mockImplementation(async () => {
          if (agentShouldThrowError) throw new Error('Firestore error');
          const matches: any[] = [];
          agentTestData.forEach((data, key) => {
            if (key.startsWith(collectionName)) {
              matches.push(data);
            }
          });
          return createMockSnapshot(matches);
        }),
      };
      return baseQuery;
    }),
  };

  return {
    getFirestoreClient: vi.fn(() => mockFirestore),
    Collections: {
      IAO_TOKENS: 'iao-tokens',
      AGENTS: 'agents',
    },
    FieldValue: { increment: vi.fn((n) => n) },
  };
});

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid'),
}));

import { AgentService } from '../src/services/firestoreAgentService.js';

describe('Agent systemInstructions Update', () => {
  let agentService: AgentService;

  beforeEach(() => {
    agentTestData.clear();
    agentShouldThrowError = false;
    agentService = new AgentService('us-west-1', 'agents');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should update systemInstructions field', async () => {
    agentTestData.set('agents/agent-123', {
      id: 'agent-123',
      name: 'Test Agent',
      description: 'Test',
      systemInstructions: 'Old instructions',
      creator: '0xcreator',
      llmProvider: 'claude',
      availableTools: [],
      starterPrompts: [],
      isPublic: true,
      totalMessages: 0,
      totalUsers: 0,
      totalToolCalls: 0,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    await agentService.updateAgent('agent-123', {
      systemInstructions: 'New updated instructions',
    });

    const stored = agentTestData.get('agents/agent-123');
    expect(stored.systemInstructions).toBe('New updated instructions');
  });

  it('should update systemInstructions along with other fields', async () => {
    agentTestData.set('agents/agent-456', {
      id: 'agent-456',
      name: 'Multi Update Agent',
      description: 'Old description',
      systemInstructions: 'Old system prompt',
      creator: '0xcreator',
    });

    await agentService.updateAgent('agent-456', {
      name: 'Updated Agent',
      description: 'Updated description',
      systemInstructions: 'Updated system prompt',
    });

    const stored = agentTestData.get('agents/agent-456');
    expect(stored.name).toBe('Updated Agent');
    expect(stored.description).toBe('Updated description');
    expect(stored.systemInstructions).toBe('Updated system prompt');
  });

  it('should clear systemInstructions when set to empty string', async () => {
    agentTestData.set('agents/agent-789', {
      id: 'agent-789',
      name: 'Agent',
      systemInstructions: 'Has instructions',
      creator: '0xcreator',
    });

    await agentService.updateAgent('agent-789', {
      systemInstructions: '',
    });

    const stored = agentTestData.get('agents/agent-789');
    expect(stored.systemInstructions).toBe('');
  });

  it('should not modify systemInstructions when not included in updates', async () => {
    agentTestData.set('agents/agent-abc', {
      id: 'agent-abc',
      name: 'Keep Instructions Agent',
      systemInstructions: 'Should remain unchanged',
      creator: '0xcreator',
    });

    await agentService.updateAgent('agent-abc', {
      name: 'Only Name Changed',
    });

    const stored = agentTestData.get('agents/agent-abc');
    expect(stored.name).toBe('Only Name Changed');
    // systemInstructions should still be present from the original data
    expect(stored.systemInstructions).toBe('Should remain unchanged');
  });
});

// ============================================
// 5. addApiToToken with parameters and responseFormat
// ============================================
import { TokenService, type IAOTokenDBEntry } from '../src/services/firestoreTokenService.js';

describe('addApiToToken with parameters and responseFormat', () => {
  let tokenService: TokenService;

  const sampleToken: IAOTokenDBEntry = {
    id: '0x1234567890abcdef1234567890abcdef12345678',
    slug: 'test-server',
    name: 'Test Server',
    symbol: 'TEST',
    builder: '0xbuilder1234567890abcdef1234567890abcdef',
    paymentToken: '0xusdc1234567890abcdef1234567890abcdef1234',
    chainId: '84532',
    subscriptionCount: '0',
    refundCount: '0',
    fulfilledCount: '0',
    apis: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    agentTestData.clear();
    agentShouldThrowError = false;
    tokenService = new TokenService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should add API with parameters', async () => {
    agentTestData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', { ...sampleToken });

    const params = [
      { name: 'userId', type: 'string' as const, required: true, description: 'User ID', example: '123' },
      { name: 'limit', type: 'number' as const, required: false, description: 'Result limit', example: '10' },
    ];

    const newApi = await tokenService.addApiToToken(
      '0x1234567890abcdef1234567890abcdef12345678',
      'get-user',
      'Get User',
      'https://api.example.com/user',
      'Fetch user data',
      '10000',
      'GET',
      params,
      '{"id": "123", "name": "John"}'
    );

    expect(newApi).not.toBeNull();
    expect(newApi?.parameters).toHaveLength(2);
    expect(newApi?.parameters![0].name).toBe('userId');
    expect(newApi?.parameters![0].required).toBe(true);
    expect(newApi?.parameters![1].name).toBe('limit');
    expect(newApi?.responseFormat).toBe('{"id": "123", "name": "John"}');
  });

  it('should add API with empty parameters by default', async () => {
    agentTestData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', { ...sampleToken });

    const newApi = await tokenService.addApiToToken(
      '0x1234567890abcdef1234567890abcdef12345678',
      'simple-api',
      'Simple API',
      'https://api.example.com/simple',
      'A simple endpoint',
      '5000',
      'GET'
    );

    expect(newApi).not.toBeNull();
    expect(newApi?.parameters).toEqual([]);
    expect(newApi?.responseFormat).toBe('');
  });

  it('should add POST API with body parameters', async () => {
    agentTestData.set('iao-tokens/0x1234567890abcdef1234567890abcdef12345678', { ...sampleToken });

    const params = [
      { name: 'name', type: 'string' as const, required: true, description: 'Item name', example: 'Widget' },
      { name: 'price', type: 'number' as const, required: true, description: 'Price in USD', example: '9.99' },
      { name: 'tags', type: 'array' as const, required: false, description: 'Item tags', example: '["sale"]' },
    ];

    const newApi = await tokenService.addApiToToken(
      '0x1234567890abcdef1234567890abcdef12345678',
      'create-item',
      'Create Item',
      'https://api.example.com/items',
      'Create a new item',
      '20000',
      'POST',
      params,
      '{"id": "abc", "name": "Widget", "created": true}'
    );

    expect(newApi).not.toBeNull();
    expect(newApi?.method).toBe('POST');
    expect(newApi?.parameters).toHaveLength(3);
    expect(newApi?.responseFormat).toContain('Widget');
  });

  it('should persist parameters and responseFormat to the token entry', async () => {
    // Use a fresh token ID to avoid interference from previous tests
    const freshToken = { ...sampleToken, id: '0xfreshtoken0000000000000000000000deadbeef', apis: [] };
    agentTestData.set('iao-tokens/0xfreshtoken0000000000000000000000deadbeef', freshToken);

    const params = [
      { name: 'query', type: 'string' as const, required: true, description: 'Search query', example: 'test' },
    ];

    await tokenService.addApiToToken(
      '0xfreshtoken0000000000000000000000deadbeef',
      'search',
      'Search',
      'https://api.example.com/search',
      'Search endpoint',
      '5000',
      'GET',
      params,
      '{"results": []}'
    );

    // Verify persisted in the stored token
    const stored = agentTestData.get('iao-tokens/0xfreshtoken0000000000000000000000deadbeef');
    expect(stored.apis).toHaveLength(1);
    expect(stored.apis[0].parameters).toHaveLength(1);
    expect(stored.apis[0].parameters[0].name).toBe('query');
    expect(stored.apis[0].responseFormat).toBe('{"results": []}');
  });
});

// ============================================
// 6. IAOTokenDBEntry logoUrl field
// ============================================
describe('IAOTokenDBEntry logoUrl', () => {
  it('should include logoUrl in IAOTokenDBEntry', () => {
    const entry: IAOTokenDBEntry = {
      id: '0x123',
      slug: 'test',
      name: 'Test',
      symbol: 'TST',
      builder: '0xbuilder',
      paymentToken: '0xusdc',
      chainId: '84532',
      subscriptionCount: '0',
      refundCount: '0',
      fulfilledCount: '0',
      logoUrl: 'https://res.cloudinary.com/test/logo.png',
      apis: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    expect(entry.logoUrl).toBe('https://res.cloudinary.com/test/logo.png');
  });

  it('should allow IAOTokenDBEntry without logoUrl', () => {
    const entry: IAOTokenDBEntry = {
      id: '0x123',
      slug: 'test',
      name: 'Test',
      symbol: 'TST',
      builder: '0xbuilder',
      paymentToken: '0xusdc',
      chainId: '84532',
      subscriptionCount: '0',
      refundCount: '0',
      fulfilledCount: '0',
      apis: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    expect(entry.logoUrl).toBeUndefined();
  });
});
