/**
 * Tests for Rate Limiter Middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock the firestoreRateLimitService
vi.mock('../src/services/firestoreRateLimitService.js', () => ({
  checkRateLimit: vi.fn(),
  getIpKey: vi.fn((ip: string) => `ip:${ip}`),
  getWalletKey: vi.fn((wallet: string) => `wallet:${wallet.toLowerCase()}`),
  getApiKey: vi.fn((server: string, api: string) => `api:${server.toLowerCase()}:${api.toLowerCase()}`),
  getGlobalKey: vi.fn(() => 'global'),
  RATE_LIMITS: {
    global: { windowMs: 60000, max: 1000 },
    ip: { windowMs: 60000, max: 100 },
    wallet: { windowMs: 60000, max: 50 },
    api: { windowMs: 60000, max: 200 },
  },
}));

import {
  globalRateLimiter,
  ipRateLimiter,
  walletRateLimiter,
  apiRateLimiter,
  combinedApiRateLimiter,
  getRateLimitConfig,
} from '../src/middleware/rateLimiter.js';
import { checkRateLimit } from '../src/services/firestoreRateLimitService.js';

describe('rateLimiter middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let statusCode: number;
  let responseBody: any;
  let responseHeaders: Record<string, string>;

  beforeEach(() => {
    mockReq = {
      path: '/api/magpie/get-quote',
      ip: '192.168.1.1',
      socket: { remoteAddress: '192.168.1.1' } as any,
      headers: {},
      params: { serverSlug: 'magpie', apiSlug: 'get-quote' },
    };

    responseHeaders = {};
    mockRes = {
      set: vi.fn((headers: any) => {
        Object.assign(responseHeaders, headers);
        return mockRes as Response;
      }),
      status: vi.fn((code: number) => {
        statusCode = code;
        return mockRes as Response;
      }),
      json: vi.fn((body: any) => {
        responseBody = body;
        return mockRes as Response;
      }),
    };

    mockNext = vi.fn();

    // Default mock: allow requests
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      current: 1,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60000,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('globalRateLimiter', () => {
    it('should skip health check endpoints', async () => {
      mockReq.path = '/health';

      await globalRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    it('should skip root endpoint', async () => {
      mockReq.path = '/';

      await globalRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    it('should allow request when under limit', async () => {
      await globalRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(responseHeaders['RateLimit-Limit']).toBe('100');
      expect(responseHeaders['RateLimit-Remaining']).toBe('99');
    });

    it('should block request when limit exceeded', async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({
        allowed: false,
        current: 100,
        limit: 100,
        remaining: 0,
        resetAt: Date.now() + 30000,
        retryAfter: 30,
      });

      await globalRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusCode).toBe(429);
      expect(responseBody.error).toBe('Too many requests');
    });

    it('should fail open on error', async () => {
      vi.mocked(checkRateLimit).mockRejectedValue(new Error('Service unavailable'));

      await globalRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('ipRateLimiter', () => {
    it('should extract IP from request', async () => {
      await ipRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(checkRateLimit).toHaveBeenCalledWith('ip:192.168.1.1', 'ip');
    });

    it('should extract IP from X-Forwarded-For header', async () => {
      mockReq.headers = { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' };

      await ipRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(checkRateLimit).toHaveBeenCalledWith('ip:10.0.0.1', 'ip');
    });

    it('should block when IP limit exceeded', async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({
        allowed: false,
        current: 100,
        limit: 100,
        remaining: 0,
        resetAt: Date.now() + 30000,
        retryAfter: 30,
      });

      await ipRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(statusCode).toBe(429);
      expect(responseBody.message).toContain('IP');
    });
  });

  describe('walletRateLimiter', () => {
    it('should skip non-API routes', async () => {
      mockReq.path = '/api/servers';

      await walletRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    it('should skip when no payment signature', async () => {
      await walletRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should extract wallet from payment signature (EVM)', async () => {
      const paymentData = Buffer.from(JSON.stringify({ from: '0xABCDEF' })).toString('base64');
      mockReq.headers = { 'payment-signature': paymentData };

      await walletRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(checkRateLimit).toHaveBeenCalledWith('wallet:0xabcdef', 'wallet');
    });

    it('should extract wallet from payment signature (Solana)', async () => {
      const paymentData = Buffer.from(JSON.stringify({ payer: 'SolanaWallet123' })).toString('base64');
      mockReq.headers = { 'payment-signature': paymentData };

      await walletRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(checkRateLimit).toHaveBeenCalledWith('wallet:solanawallet123', 'wallet');
    });

    it('should block when wallet limit exceeded', async () => {
      const paymentData = Buffer.from(JSON.stringify({ from: '0xWallet' })).toString('base64');
      mockReq.headers = { 'payment-signature': paymentData };

      vi.mocked(checkRateLimit).mockResolvedValue({
        allowed: false,
        current: 50,
        limit: 50,
        remaining: 0,
        resetAt: Date.now() + 30000,
        retryAfter: 30,
      });

      await walletRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(statusCode).toBe(429);
      expect(responseBody.message).toContain('wallet');
    });
  });

  describe('apiRateLimiter', () => {
    it('should skip non-API routes', async () => {
      mockReq.path = '/api/servers';

      await apiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    it('should check API rate limit', async () => {
      await apiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(checkRateLimit).toHaveBeenCalledWith('api:magpie:get-quote', 'api');
    });

    it('should extract slugs from path when params not available', async () => {
      mockReq.params = {};

      await apiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(checkRateLimit).toHaveBeenCalledWith('api:magpie:get-quote', 'api');
    });

    it('should block when API limit exceeded', async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({
        allowed: false,
        current: 200,
        limit: 200,
        remaining: 0,
        resetAt: Date.now() + 30000,
        retryAfter: 30,
      });

      await apiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(statusCode).toBe(429);
      expect(responseBody.message).toContain('API endpoint');
    });
  });

  describe('combinedApiRateLimiter', () => {
    it('should check all limits in sequence', async () => {
      const paymentData = Buffer.from(JSON.stringify({ from: '0xWallet' })).toString('base64');
      mockReq.headers = { 'payment-signature': paymentData };

      await combinedApiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(checkRateLimit).toHaveBeenCalledWith('global', 'global');
      expect(checkRateLimit).toHaveBeenCalledWith('ip:192.168.1.1', 'ip');
      expect(checkRateLimit).toHaveBeenCalledWith('wallet:0xwallet', 'wallet');
      expect(checkRateLimit).toHaveBeenCalledWith('api:magpie:get-quote', 'api');
    });

    it('should stop at first failed limit', async () => {
      vi.mocked(checkRateLimit)
        .mockResolvedValueOnce({
          allowed: true,
          current: 1,
          limit: 1000,
          remaining: 999,
          resetAt: Date.now() + 60000,
        })
        .mockResolvedValueOnce({
          allowed: false,
          current: 100,
          limit: 100,
          remaining: 0,
          resetAt: Date.now() + 30000,
          retryAfter: 30,
        });

      await combinedApiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(statusCode).toBe(429);
      expect(checkRateLimit).toHaveBeenCalledTimes(2); // Stopped after IP limit
    });

    it('should skip wallet check when no payment signature', async () => {
      await combinedApiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      // Should only check global, IP, and API (not wallet)
      expect(checkRateLimit).toHaveBeenCalledTimes(3);
    });
  });

  describe('getRateLimitConfig', () => {
    it('should return rate limit configuration', () => {
      const config = getRateLimitConfig();

      expect(config.global).toBeDefined();
      expect(config.ip).toBeDefined();
      expect(config.wallet).toBeDefined();
      expect(config.api).toBeDefined();
    });
  });

  describe('rate limit headers', () => {
    it('should set rate limit headers on success', async () => {
      await globalRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(responseHeaders['RateLimit-Limit']).toBeDefined();
      expect(responseHeaders['RateLimit-Remaining']).toBeDefined();
      expect(responseHeaders['RateLimit-Reset']).toBeDefined();
    });

    it('should set Retry-After header on rate limit', async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({
        allowed: false,
        current: 100,
        limit: 100,
        remaining: 0,
        resetAt: Date.now() + 30000,
        retryAfter: 30,
      });

      await globalRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(responseHeaders['Retry-After']).toBe('30');
    });

    it('should use default Retry-After when not provided', async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({
        allowed: false,
        current: 100,
        limit: 100,
        remaining: 0,
        resetAt: Date.now() + 30000,
        // No retryAfter provided
      });

      await globalRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(responseHeaders['Retry-After']).toBe('60'); // Default 60
    });
  });

  describe('IP extraction edge cases', () => {
    it('should handle X-Forwarded-For as array', async () => {
      mockReq.headers = { 'x-forwarded-for': ['10.0.0.1', '192.168.1.1'] as any };

      await ipRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(checkRateLimit).toHaveBeenCalledWith('ip:10.0.0.1', 'ip');
    });

    it('should fall back to req.ip when no X-Forwarded-For', async () => {
      mockReq.headers = {};
      mockReq.ip = '127.0.0.1';

      await ipRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(checkRateLimit).toHaveBeenCalledWith('ip:127.0.0.1', 'ip');
    });

    it('should fall back to socket.remoteAddress when no req.ip', async () => {
      mockReq.headers = {};
      mockReq.ip = undefined;
      mockReq.socket = { remoteAddress: '10.10.10.10' } as any;

      await ipRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(checkRateLimit).toHaveBeenCalledWith('ip:10.10.10.10', 'ip');
    });

    it('should use "unknown" when all IP sources fail', async () => {
      mockReq.headers = {};
      mockReq.ip = undefined;
      mockReq.socket = {} as any;

      await ipRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(checkRateLimit).toHaveBeenCalledWith('ip:unknown', 'ip');
    });
  });

  describe('wallet extraction edge cases', () => {
    it('should handle array payment-signature header', async () => {
      mockReq.headers = { 'payment-signature': ['first', 'second'] as any };

      await walletRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      // Should skip wallet check when array
      expect(checkRateLimit).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle invalid base64 in payment-signature', async () => {
      mockReq.headers = { 'payment-signature': 'not-valid-base64!!!' };

      await walletRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      // Should skip wallet check when invalid
      expect(checkRateLimit).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle valid base64 with invalid JSON', async () => {
      mockReq.headers = { 'payment-signature': Buffer.from('not json').toString('base64') };

      await walletRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      // Should skip wallet check when invalid JSON
      expect(checkRateLimit).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle JSON without from or payer field', async () => {
      const paymentData = Buffer.from(JSON.stringify({ other: 'field' })).toString('base64');
      mockReq.headers = { 'payment-signature': paymentData };

      await walletRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      // Should skip wallet check when no wallet address
      expect(checkRateLimit).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('ipRateLimiter should fail open on error', async () => {
      vi.mocked(checkRateLimit).mockRejectedValue(new Error('Service unavailable'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await ipRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('IP rate limiter error:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('walletRateLimiter should fail open on error', async () => {
      const paymentData = Buffer.from(JSON.stringify({ from: '0xWallet' })).toString('base64');
      mockReq.headers = { 'payment-signature': paymentData };
      vi.mocked(checkRateLimit).mockRejectedValue(new Error('Service unavailable'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await walletRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Wallet rate limiter error:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('apiRateLimiter should fail open on error', async () => {
      vi.mocked(checkRateLimit).mockRejectedValue(new Error('Service unavailable'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await apiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('API rate limiter error:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('combinedApiRateLimiter should fail open on error', async () => {
      vi.mocked(checkRateLimit).mockRejectedValue(new Error('Service unavailable'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await combinedApiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Combined rate limiter error:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('combinedApiRateLimiter denial paths', () => {
    it('should skip health check endpoints', async () => {
      mockReq.path = '/health';

      await combinedApiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    it('should skip root endpoint', async () => {
      mockReq.path = '/';

      await combinedApiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    it('should deny on global limit exceeded', async () => {
      vi.mocked(checkRateLimit).mockResolvedValueOnce({
        allowed: false,
        current: 1000,
        limit: 1000,
        remaining: 0,
        resetAt: Date.now() + 30000,
        retryAfter: 30,
      });

      await combinedApiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(statusCode).toBe(429);
      expect(responseBody.message).toContain('Service is receiving too many requests');
      expect(checkRateLimit).toHaveBeenCalledTimes(1);
    });

    it('should deny on wallet limit exceeded', async () => {
      const paymentData = Buffer.from(JSON.stringify({ from: '0xWallet' })).toString('base64');
      mockReq.headers = { 'payment-signature': paymentData };

      vi.mocked(checkRateLimit)
        .mockResolvedValueOnce({ allowed: true, current: 1, limit: 1000, remaining: 999, resetAt: Date.now() + 60000 }) // global
        .mockResolvedValueOnce({ allowed: true, current: 1, limit: 100, remaining: 99, resetAt: Date.now() + 60000 }) // ip
        .mockResolvedValueOnce({ allowed: false, current: 50, limit: 50, remaining: 0, resetAt: Date.now() + 30000, retryAfter: 30 }); // wallet

      await combinedApiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(statusCode).toBe(429);
      expect(responseBody.message).toContain('wallet');
      expect(checkRateLimit).toHaveBeenCalledTimes(3);
    });

    it('should deny on API limit exceeded', async () => {
      vi.mocked(checkRateLimit)
        .mockResolvedValueOnce({ allowed: true, current: 1, limit: 1000, remaining: 999, resetAt: Date.now() + 60000 }) // global
        .mockResolvedValueOnce({ allowed: true, current: 1, limit: 100, remaining: 99, resetAt: Date.now() + 60000 }) // ip
        .mockResolvedValueOnce({ allowed: false, current: 200, limit: 200, remaining: 0, resetAt: Date.now() + 30000, retryAfter: 30 }); // api

      await combinedApiRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(statusCode).toBe(429);
      expect(responseBody.message).toContain('API endpoint');
    });
  });

  describe('ipRateLimiter edge cases', () => {
    it('should skip health check endpoints', async () => {
      mockReq.path = '/health';

      await ipRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    it('should skip root endpoint', async () => {
      mockReq.path = '/';

      await ipRateLimiter(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(checkRateLimit).not.toHaveBeenCalled();
    });
  });
});
