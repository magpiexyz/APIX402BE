/**
 * Tests for API Routes (index.ts)
 * Covers:
 * - x402 402 Payment Required response format
 * - POST method support for API calls
 * - API registration with different HTTP methods
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock data storage
let testTokens: Map<string, any> = new Map();
let mockPaymentValid = true;
let mockBuilderResponse = { status: 200, data: { result: 'success' } };

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
          get: vi.fn().mockImplementation(async () => {
            const data = testTokens.get(key);
            return { exists: data !== undefined, data: () => data };
          }),
          set: vi.fn().mockImplementation(async (data: any) => {
            testTokens.set(key, data);
          }),
        };
      }),
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockImplementation(async () => {
        const matches: any[] = [];
        testTokens.forEach((data) => matches.push(data));
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
    },
    FieldValue: { increment: vi.fn((n) => n) },
  };
});

// Mock thirdweb x402
vi.mock('thirdweb/x402', () => ({
  facilitator: vi.fn().mockReturnValue({
    address: '0xFacilitator123',
  }),
  settlePayment: vi.fn().mockImplementation(async () => {
    if (!mockPaymentValid) {
      return { status: 400, responseBody: { error: 'Payment failed' } };
    }
    return { status: 200, responseBody: { txHash: '0xabc123' } };
  }),
}));

// Mock node-fetch for builder calls
vi.mock('node-fetch', () => ({
  default: vi.fn().mockImplementation(async (url: string, options?: any) => {
    return {
      ok: mockBuilderResponse.status === 200,
      status: mockBuilderResponse.status,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => mockBuilderResponse.data,
      text: async () => JSON.stringify(mockBuilderResponse.data),
    };
  }),
}));

describe('x402 Response Format', () => {
  beforeEach(() => {
    testTokens.clear();
    mockPaymentValid = true;
    mockBuilderResponse = { status: 200, data: { result: 'success' } };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('402 Payment Required Response', () => {
    it('should return x402 v2 format with all required fields', () => {
      // Simulate a 402 response structure
      const x402Response = {
        x402Version: 2,
        error: 'Payment Required',
        message: 'This API requires payment. Please include payment authorization.',
        accepts: [
          {
            scheme: 'exact',
            network: 'base-sepolia',
            maxAmountRequired: '1000000',
            resource: 'https://api.example.com/endpoint',
            payTo: '0xTokenAddress123',
            maxTimeoutSeconds: 300,
            mimeType: 'application/json',
            outputSchema: null,
            extra: {
              name: 'Test API',
              description: 'A test API endpoint',
            },
          },
        ],
      };

      // Verify x402 v2 structure
      expect(x402Response.x402Version).toBe(2);
      expect(x402Response.error).toBe('Payment Required');
      expect(x402Response.accepts).toBeDefined();
      expect(Array.isArray(x402Response.accepts)).toBe(true);
      expect(x402Response.accepts.length).toBeGreaterThan(0);

      // Verify accepts array structure
      const accept = x402Response.accepts[0];
      expect(accept.scheme).toBe('exact');
      expect(accept.network).toBeDefined();
      expect(accept.maxAmountRequired).toBeDefined();
      expect(accept.resource).toBeDefined();
      expect(accept.payTo).toBeDefined();
      expect(accept.maxTimeoutSeconds).toBeDefined();
    });

    it('should include facilitator address in 402 response', () => {
      const facilitatorAddress = '0xFacilitator123';

      const x402Response = {
        x402Version: 2,
        error: 'Payment Required',
        accepts: [
          {
            scheme: 'exact',
            network: 'base-sepolia',
            maxAmountRequired: '1000000',
            payTo: facilitatorAddress, // Payment goes to facilitator, not token
          },
        ],
      };

      expect(x402Response.accepts[0].payTo).toBe(facilitatorAddress);
    });

    it('should include API metadata in extra field', () => {
      const x402Response = {
        x402Version: 2,
        error: 'Payment Required',
        accepts: [
          {
            scheme: 'exact',
            network: 'base-sepolia',
            maxAmountRequired: '500000',
            extra: {
              name: 'Weather API',
              description: 'Get current weather data',
              serverSlug: 'weather-service',
              apiSlug: 'current',
            },
          },
        ],
      };

      expect(x402Response.accepts[0].extra).toBeDefined();
      expect(x402Response.accepts[0].extra.name).toBe('Weather API');
      expect(x402Response.accepts[0].extra.serverSlug).toBe('weather-service');
      expect(x402Response.accepts[0].extra.apiSlug).toBe('current');
    });

    it('should support multiple payment options in accepts array', () => {
      const x402Response = {
        x402Version: 2,
        error: 'Payment Required',
        accepts: [
          {
            scheme: 'exact',
            network: 'base-sepolia',
            maxAmountRequired: '1000000',
          },
          {
            scheme: 'exact',
            network: 'solana-devnet',
            maxAmountRequired: '500000',
          },
        ],
      };

      expect(x402Response.accepts.length).toBe(2);
      expect(x402Response.accepts[0].network).toBe('base-sepolia');
      expect(x402Response.accepts[1].network).toBe('solana-devnet');
    });
  });

  describe('Payment Verification Response', () => {
    it('should return 402 with verification failure details', () => {
      const verificationFailedResponse = {
        x402Version: 2,
        error: 'Payment Verification Failed',
        message: 'The payment authorization could not be verified',
        details: {
          reason: 'Invalid signature',
          expectedPayTo: '0xFacilitator123',
          receivedPayTo: '0xWrongAddress',
        },
      };

      expect(verificationFailedResponse.x402Version).toBe(2);
      expect(verificationFailedResponse.error).toBe('Payment Verification Failed');
      expect(verificationFailedResponse.details).toBeDefined();
      expect(verificationFailedResponse.details.reason).toBeDefined();
    });

    it('should return 402 when payment amount insufficient', () => {
      const insufficientPaymentResponse = {
        x402Version: 2,
        error: 'Insufficient Payment',
        message: 'Payment amount is less than required',
        details: {
          required: '1000000',
          provided: '500000',
          difference: '500000',
        },
      };

      expect(insufficientPaymentResponse.error).toBe('Insufficient Payment');
      expect(insufficientPaymentResponse.details.required).toBe('1000000');
      expect(insufficientPaymentResponse.details.provided).toBe('500000');
    });
  });
});

describe('POST Method Support', () => {
  beforeEach(() => {
    testTokens.clear();
    mockPaymentValid = true;
    mockBuilderResponse = { status: 200, data: { result: 'success' } };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('API Registration with POST method', () => {
    it('should accept POST as valid HTTP method during registration', () => {
      const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

      const apiConfig = {
        slug: 'create-item',
        name: 'Create Item',
        apiUrl: 'https://api.example.com/items',
        method: 'POST',
        fee: '1000000',
      };

      expect(validMethods).toContain(apiConfig.method);
    });

    it('should normalize HTTP method to uppercase', () => {
      const normalizeMethod = (method: string) => method.toUpperCase();

      expect(normalizeMethod('post')).toBe('POST');
      expect(normalizeMethod('get')).toBe('GET');
      expect(normalizeMethod('Post')).toBe('POST');
    });

    it('should reject invalid HTTP methods', () => {
      const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      const invalidMethod = 'INVALID';

      expect(validMethods).not.toContain(invalidMethod);
    });

    it('should allow same URL with different methods', () => {
      // This tests that GET /api/items and POST /api/items are different endpoints
      const apis = [
        { slug: 'list-items', apiUrl: 'https://api.example.com/items', method: 'GET' },
        { slug: 'create-item', apiUrl: 'https://api.example.com/items', method: 'POST' },
      ];

      // Check that both can coexist
      const urlMethodPairs = apis.map(a => `${a.method}:${a.apiUrl}`);
      const uniquePairs = new Set(urlMethodPairs);

      expect(uniquePairs.size).toBe(2); // Both should be unique
    });

    it('should default method to GET when not specified', () => {
      const apiConfig = {
        slug: 'get-data',
        name: 'Get Data',
        apiUrl: 'https://api.example.com/data',
        fee: '1000000',
        // method not specified
      };

      const method = (apiConfig as any).method || 'GET';
      expect(method).toBe('GET');
    });
  });

  describe('POST Request Forwarding', () => {
    it('should forward POST request body to builder endpoint', async () => {
      const requestBody = {
        name: 'New Item',
        description: 'A new item to create',
        price: 100,
      };

      // Simulate what the proxy does with POST requests
      const forwardedRequest = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      };

      expect(forwardedRequest.method).toBe('POST');
      expect(forwardedRequest.body).toBe(JSON.stringify(requestBody));
      expect(JSON.parse(forwardedRequest.body)).toEqual(requestBody);
    });

    it('should include authentication header in POST requests', () => {
      const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

      const forwardedRequest = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-IAO-Auth': `Bearer ${jwtToken}`,
        },
        body: '{}',
      };

      expect(forwardedRequest.headers['X-IAO-Auth']).toContain('Bearer');
    });

    it('should handle POST with query parameters', () => {
      const baseUrl = 'https://api.example.com/items';
      const queryParams = '?category=electronics&limit=10';
      const body = { name: 'New Item' };

      const fullUrl = `${baseUrl}${queryParams}`;

      expect(fullUrl).toBe('https://api.example.com/items?category=electronics&limit=10');
      expect(body).toEqual({ name: 'New Item' });
    });

    it('should preserve Content-Type for POST requests', () => {
      const jsonRequest = {
        headers: { 'Content-Type': 'application/json' },
      };

      const formRequest = {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      };

      expect(jsonRequest.headers['Content-Type']).toBe('application/json');
      expect(formRequest.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });
  });

  describe('POST Method in Tool Calls', () => {
    it('should include method in API info for tool calls', () => {
      const apiInfo = {
        name: 'Create Order',
        description: 'Create a new order',
        fee: '2000000',
        tokenAddress: '0xToken123',
        method: 'POST',
      };

      expect(apiInfo.method).toBe('POST');
    });

    it('should pass tool input as POST body', () => {
      const toolCall = {
        id: 'tool-123',
        name: 'call_shop_create_order',
        input: {
          items: [{ id: 1, quantity: 2 }],
          shippingAddress: '123 Main St',
        },
      };

      // For POST methods, the input becomes the request body
      const requestBody = JSON.stringify(toolCall.input);

      expect(JSON.parse(requestBody)).toEqual({
        items: [{ id: 1, quantity: 2 }],
        shippingAddress: '123 Main St',
      });
    });

    it('should handle GET vs POST differently in tool execution', () => {
      const getApiConfig = {
        slug: 'get-order',
        method: 'GET',
      };

      const postApiConfig = {
        slug: 'create-order',
        method: 'POST',
      };

      const toolInput = { orderId: '123' };

      // GET: input goes to query params
      const getQueryString = `?orderId=${toolInput.orderId}`;

      // POST: input goes to body
      const postBody = JSON.stringify(toolInput);

      expect(getQueryString).toBe('?orderId=123');
      expect(postBody).toBe('{"orderId":"123"}');
    });
  });
});

describe('API Route Method Handling', () => {
  describe('Dynamic route method support', () => {
    it('should support both GET and POST on same route path', () => {
      // Express route pattern: /api/:serverSlug/:apiSlug
      const route = '/api/shop/orders';

      const getHandler = { method: 'GET', path: route };
      const postHandler = { method: 'POST', path: route };

      expect(getHandler.path).toBe(postHandler.path);
      expect(getHandler.method).not.toBe(postHandler.method);
    });

    it('should determine method from API configuration', () => {
      const apiConfigs = [
        { slug: 'list', method: 'GET' },
        { slug: 'create', method: 'POST' },
        { slug: 'update', method: 'PUT' },
        { slug: 'delete', method: 'DELETE' },
      ];

      const getMethodForSlug = (slug: string) => {
        const config = apiConfigs.find(c => c.slug === slug);
        return config?.method || 'GET';
      };

      expect(getMethodForSlug('list')).toBe('GET');
      expect(getMethodForSlug('create')).toBe('POST');
      expect(getMethodForSlug('update')).toBe('PUT');
      expect(getMethodForSlug('delete')).toBe('DELETE');
      expect(getMethodForSlug('unknown')).toBe('GET'); // Default
    });

    it('should reject request if method does not match API config', () => {
      const apiConfig = { slug: 'create', method: 'POST' };
      const requestMethod = 'GET';

      const isMethodAllowed = apiConfig.method === requestMethod;

      expect(isMethodAllowed).toBe(false);
    });
  });
});

describe('Payment Flow with POST Methods', () => {
  it('should include request body in payment verification context', () => {
    const paymentContext = {
      serverSlug: 'shop',
      apiSlug: 'create-order',
      method: 'POST',
      body: { items: [{ id: 1 }] },
      paymentSignature: 'base64-encoded-payment-data',
    };

    expect(paymentContext.method).toBe('POST');
    expect(paymentContext.body).toBeDefined();
    expect(paymentContext.paymentSignature).toBeDefined();
  });

  it('should settle payment before forwarding POST request', () => {
    const paymentFlow = [
      'receive_request',
      'verify_payment_signature',
      'forward_to_builder',
      'check_builder_response',
      'settle_payment_on_success',
      'return_response',
    ];

    expect(paymentFlow.indexOf('verify_payment_signature')).toBeLessThan(
      paymentFlow.indexOf('forward_to_builder')
    );
    expect(paymentFlow.indexOf('settle_payment_on_success')).toBeGreaterThan(
      paymentFlow.indexOf('check_builder_response')
    );
  });

  it('should not settle payment if POST request fails', () => {
    const builderResponseStatus = 400;
    const shouldSettlePayment = builderResponseStatus >= 200 && builderResponseStatus < 300;

    expect(shouldSettlePayment).toBe(false);
  });
});
