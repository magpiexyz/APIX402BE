/**
 * Tests for Multi-Chain Payment Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original env
const originalEnv = process.env;

// Mock thirdweb SDK
vi.mock('thirdweb/x402', () => ({
  facilitator: vi.fn(() => ({ mock: 'facilitator' })),
  settlePayment: vi.fn(),
}));

vi.mock('thirdweb', () => ({
  createThirdwebClient: vi.fn(() => ({ mock: 'client' })),
}));

vi.mock('thirdweb/chains', () => ({
  baseSepolia: { id: 84532, name: 'Base Sepolia' },
}));

import { facilitator, settlePayment } from 'thirdweb/x402';
import { createThirdwebClient } from 'thirdweb';

describe('MultiChainPaymentService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.THIRDWEB_SECRET_KEY = 'test-secret';
    process.env.THIRDWEB_SERVER_WALLET_ADDRESS = '0xWalletAddress';
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize when credentials are set', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      expect(createThirdwebClient).toHaveBeenCalled();
      expect(service.isInitialized()).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should warn when credentials missing', async () => {
      delete process.env.THIRDWEB_SECRET_KEY;
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.resetModules();
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('credentials not set'));
      expect(service.isInitialized()).toBe(false);
      consoleSpy.mockRestore();
    });

    it('should handle Thirdweb initialization error', async () => {
      vi.mocked(createThirdwebClient).mockImplementation(() => {
        throw new Error('Failed to create client');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.resetModules();
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize'), expect.any(Error));
      expect(service.isInitialized()).toBe(false);
      consoleSpy.mockRestore();

      // Reset mock for other tests
      vi.mocked(createThirdwebClient).mockReturnValue({ mock: 'client' } as any);
    });
  });

  describe('verifyEVMPayment', () => {
    it('should verify valid EVM payment', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const now = Math.floor(Date.now() / 1000);
      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {
            from: '0xUserWallet',
            to: '0xTokenAddress',
            value: '1000000',
            validAfter: (now - 60).toString(),
            validBefore: (now + 300).toString(),
            nonce: '12345',
          },
          signature: '0xSignature',
        },
      })).toString('base64');

      const result = service.verifyEVMPayment(paymentData, '0xTokenAddress', '1000000');

      expect(result.valid).toBe(true);
      expect(result.userAddress).toBe('0xuserwallet');
      expect(result.chainType).toBe('evm');
    });

    it('should reject when recipient mismatch', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const now = Math.floor(Date.now() / 1000);
      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {
            from: '0xUserWallet',
            to: '0xWrongAddress',
            value: '1000000',
            validAfter: (now - 60).toString(),
            validBefore: (now + 300).toString(),
          },
          signature: '0xSignature',
        },
      })).toString('base64');

      const result = service.verifyEVMPayment(paymentData, '0xTokenAddress', '1000000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('recipient mismatch');
    });

    it('should reject when amount mismatch', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const now = Math.floor(Date.now() / 1000);
      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {
            from: '0xUserWallet',
            to: '0xTokenAddress',
            value: '999999',
            validAfter: (now - 60).toString(),
            validBefore: (now + 300).toString(),
          },
          signature: '0xSignature',
        },
      })).toString('base64');

      const result = service.verifyEVMPayment(paymentData, '0xTokenAddress', '1000000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('amount mismatch');
    });

    it('should reject expired payment', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const now = Math.floor(Date.now() / 1000);
      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {
            from: '0xUserWallet',
            to: '0xTokenAddress',
            value: '1000000',
            validAfter: (now - 600).toString(),
            validBefore: (now - 60).toString(), // Expired
          },
          signature: '0xSignature',
        },
      })).toString('base64');

      const result = service.verifyEVMPayment(paymentData, '0xTokenAddress', '1000000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should reject payment not yet valid', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const now = Math.floor(Date.now() / 1000);
      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {
            from: '0xUserWallet',
            to: '0xTokenAddress',
            value: '1000000',
            validAfter: (now + 600).toString(), // Future
            validBefore: (now + 900).toString(),
          },
          signature: '0xSignature',
        },
      })).toString('base64');

      const result = service.verifyEVMPayment(paymentData, '0xTokenAddress', '1000000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not yet valid');
    });

    it('should reject missing authorization', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const paymentData = Buffer.from(JSON.stringify({
        payload: {},
      })).toString('base64');

      const result = service.verifyEVMPayment(paymentData, '0xTokenAddress', '1000000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing authorization');
    });

    it('should handle invalid base64', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const result = service.verifyEVMPayment('invalid-base64!!!', '0xTokenAddress', '1000000');

      expect(result.valid).toBe(false);
    });
  });

  describe('verifySolanaPayment', () => {
    it('should verify valid Solana payment', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const now = Math.floor(Date.now() / 1000);
      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {
            from: 'SolanaUserWallet123',
            to: 'SolanaTokenAddress456',
            amount: '1000000',
            validAfter: now - 60,
            validBefore: now + 300,
          },
          signature: 'SolanaSignature',
        },
      })).toString('base64');

      const result = service.verifySolanaPayment(paymentData, 'SolanaTokenAddress456', '1000000');

      expect(result.valid).toBe(true);
      expect(result.userAddress).toBe('SolanaUserWallet123'); // Solana preserves case
      expect(result.chainType).toBe('solana');
    });

    it('should reject when recipient mismatch', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {
            from: 'SolanaUserWallet',
            to: 'WrongAddress',
            amount: '1000000',
          },
          signature: 'SolanaSignature',
        },
      })).toString('base64');

      const result = service.verifySolanaPayment(paymentData, 'SolanaTokenAddress', '1000000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('recipient mismatch');
    });

    it('should reject expired Solana payment', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const now = Math.floor(Date.now() / 1000);
      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {
            from: 'SolanaUserWallet',
            to: 'SolanaTokenAddress',
            amount: '1000000',
            validAfter: now - 600,
            validBefore: now - 60, // Expired
          },
          signature: 'SolanaSignature',
        },
      })).toString('base64');

      const result = service.verifySolanaPayment(paymentData, 'SolanaTokenAddress', '1000000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should reject when Solana amount mismatch', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {
            from: 'SolanaUserWallet',
            to: 'SolanaTokenAddress',
            amount: '999999',
          },
          signature: 'SolanaSignature',
        },
      })).toString('base64');

      const result = service.verifySolanaPayment(paymentData, 'SolanaTokenAddress', '1000000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('amount mismatch');
    });

    it('should reject Solana payment not yet valid', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const now = Math.floor(Date.now() / 1000);
      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {
            from: 'SolanaUserWallet',
            to: 'SolanaTokenAddress',
            amount: '1000000',
            validAfter: now + 600, // Future
            validBefore: now + 900,
          },
          signature: 'SolanaSignature',
        },
      })).toString('base64');

      const result = service.verifySolanaPayment(paymentData, 'SolanaTokenAddress', '1000000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not yet valid');
    });

    it('should reject missing Solana authorization', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const paymentData = Buffer.from(JSON.stringify({
        payload: {},
      })).toString('base64');

      const result = service.verifySolanaPayment(paymentData, 'SolanaTokenAddress', '1000000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing authorization');
    });

    it('should handle invalid base64 for Solana payment', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const result = service.verifySolanaPayment('invalid-base64!!!', 'SolanaTokenAddress', '1000000');

      expect(result.valid).toBe(false);
      expect(result.chainType).toBe('solana');
    });
  });

  describe('verifyPaymentAuthorization', () => {
    it('should route to EVM verification', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const now = Math.floor(Date.now() / 1000);
      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {
            from: '0xUserWallet',
            to: '0xTokenAddress',
            value: '1000000',
            validAfter: (now - 60).toString(),
            validBefore: (now + 300).toString(),
          },
          signature: '0xSignature',
        },
      })).toString('base64');

      const result = service.verifyPaymentAuthorization(paymentData, '0xTokenAddress', '1000000', 'evm');

      expect(result.valid).toBe(true);
      expect(result.chainType).toBe('evm');
    });

    it('should route to Solana verification', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {
            from: 'SolanaWallet',
            to: 'SolanaToken',
            amount: '1000000',
          },
          signature: 'SolanaSignature',
        },
      })).toString('base64');

      const result = service.verifyPaymentAuthorization(paymentData, 'SolanaToken', '1000000', 'solana');

      expect(result.chainType).toBe('solana');
    });

    it('should reject unsupported chain type', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const paymentData = Buffer.from(JSON.stringify({})).toString('base64');

      const result = service.verifyPaymentAuthorization(paymentData, 'addr', '1000000', 'unknown' as any);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported chain type');
    });
  });

  describe('executeEVMPayment', () => {
    it('should fail when not initialized', async () => {
      delete process.env.THIRDWEB_SECRET_KEY;
      vi.resetModules();

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'POST',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const result = await service.executeEVMPayment(
        'payment-data',
        mockReq,
        '0xTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('should execute EVM payment successfully', async () => {
      vi.mocked(settlePayment).mockResolvedValue({
        status: 200,
        paymentReceipt: { transaction: '0xTxHash' },
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'POST',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const result = await service.executeEVMPayment(
        'payment-data',
        mockReq,
        '0xTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API'
      );

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('0xTxHash');
      consoleSpy.mockRestore();
    });

    it('should handle settlement failure', async () => {
      vi.mocked(settlePayment).mockResolvedValue({
        status: 400,
        responseBody: { errorMessage: 'Payment failed' },
      } as any);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'GET',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const result = await service.executeEVMPayment(
        'payment-data',
        mockReq,
        '0xTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Payment failed');
      consoleSpy.mockRestore();
    });

    it('should normalize HTTP methods', async () => {
      vi.mocked(settlePayment).mockResolvedValue({ status: 200 });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'head', // Should be normalized to GET
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      await service.executeEVMPayment(
        'payment-data',
        mockReq,
        '0xTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API'
      );

      expect(settlePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
        })
      );
      consoleSpy.mockRestore();
    });

    it('should handle EVM settlement exception', async () => {
      vi.mocked(settlePayment).mockRejectedValue(new Error('EVM network error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'POST',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const result = await service.executeEVMPayment(
        'payment-data',
        mockReq,
        '0xTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('EVM network error');
      consoleSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should handle EVM settlement failure without error message', async () => {
      vi.mocked(settlePayment).mockResolvedValue({
        status: 500,
        responseBody: {},
      } as any);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'POST',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const result = await service.executeEVMPayment(
        'payment-data',
        mockReq,
        '0xTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('non-200 status');
      consoleSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should normalize unsupported HTTP methods to GET', async () => {
      vi.mocked(settlePayment).mockResolvedValue({ status: 200 });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'OPTIONS', // Unsupported - should normalize to GET
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      await service.executeEVMPayment(
        'payment-data',
        mockReq,
        '0xTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API'
      );

      expect(settlePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
        })
      );
      consoleSpy.mockRestore();
    });
  });

  describe('executeSolanaPayment', () => {
    it('should fail when not initialized', async () => {
      delete process.env.THIRDWEB_SECRET_KEY;
      vi.resetModules();

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'POST',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const chainConfig = {
        chainId: 'solana-devnet',
        chainType: 'solana' as const,
        rpcUrl: 'https://api.devnet.solana.com',
        isActive: true,
        displayName: 'Solana Devnet',
      };

      const result = await service.executeSolanaPayment(
        'payment-data',
        mockReq,
        'SolanaTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API',
        chainConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('should execute Solana payment successfully', async () => {
      vi.mocked(settlePayment).mockResolvedValue({
        status: 200,
        paymentReceipt: { transaction: 'SolanaTxSignature' },
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'POST',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const chainConfig = {
        chainId: 'solana-devnet',
        chainType: 'solana' as const,
        rpcUrl: 'https://api.devnet.solana.com',
        isActive: true,
        displayName: 'Solana Devnet',
      };

      const result = await service.executeSolanaPayment(
        'payment-data',
        mockReq,
        'SolanaTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API',
        chainConfig
      );

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('SolanaTxSignature');
      consoleSpy.mockRestore();
    });

    it('should handle Solana settlement failure (non-200 status)', async () => {
      vi.mocked(settlePayment).mockResolvedValue({
        status: 400,
        responseBody: { errorMessage: 'Solana payment failed' },
      } as any);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'GET',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/solana-test',
      };

      const chainConfig = {
        chainId: 'solana-devnet',
        chainType: 'solana' as const,
        rpcUrl: 'https://api.devnet.solana.com',
        isActive: true,
        displayName: 'Solana Devnet',
      };

      const result = await service.executeSolanaPayment(
        'payment-data',
        mockReq,
        'SolanaTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API',
        chainConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Solana payment failed');
      consoleSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should handle Solana settlement failure without error message', async () => {
      vi.mocked(settlePayment).mockResolvedValue({
        status: 500,
        responseBody: {},
      } as any);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'POST',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const chainConfig = {
        chainId: 'solana-devnet',
        chainType: 'solana' as const,
        rpcUrl: 'https://api.devnet.solana.com',
        isActive: true,
        displayName: 'Solana Devnet',
      };

      const result = await service.executeSolanaPayment(
        'payment-data',
        mockReq,
        'SolanaTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API',
        chainConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('non-200 status');
      consoleSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should handle Solana settlement exception', async () => {
      vi.mocked(settlePayment).mockRejectedValue(new Error('Solana network error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'POST',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const chainConfig = {
        chainId: 'solana-devnet',
        chainType: 'solana' as const,
        rpcUrl: 'https://api.devnet.solana.com',
        isActive: true,
        displayName: 'Solana Devnet',
      };

      const result = await service.executeSolanaPayment(
        'payment-data',
        mockReq,
        'SolanaTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API',
        chainConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Solana network error');
      consoleSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should normalize HTTP methods for Solana payments', async () => {
      vi.mocked(settlePayment).mockResolvedValue({ status: 200 });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'OPTIONS', // Unsupported - should normalize to GET
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const chainConfig = {
        chainId: 'solana-devnet',
        chainType: 'solana' as const,
        rpcUrl: 'https://api.devnet.solana.com',
        isActive: true,
        displayName: 'Solana Devnet',
      };

      await service.executeSolanaPayment(
        'payment-data',
        mockReq,
        'SolanaTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API',
        chainConfig
      );

      expect(settlePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
        })
      );
      consoleSpy.mockRestore();
    });
  });

  describe('executePaymentTransfer', () => {
    it('should route to EVM execution', async () => {
      vi.mocked(settlePayment).mockResolvedValue({ status: 200 });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'POST',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const result = await service.executePaymentTransfer(
        'payment-data',
        mockReq,
        '0xTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API',
        'evm'
      );

      expect(result.success).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should require chainConfig for Solana', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'POST',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const result = await service.executePaymentTransfer(
        'payment-data',
        mockReq,
        'SolanaToken',
        '1000000',
        'test-server',
        'test-api',
        'Test API',
        'solana',
        undefined // Missing chainConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Chain config required');
      consoleSpy.mockRestore();
    });

    it('should reject unsupported chain type', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'POST',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const result = await service.executePaymentTransfer(
        'payment-data',
        mockReq,
        'addr',
        '1000000',
        'test-server',
        'test-api',
        'Test API',
        'bitcoin' as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported chain type');
      consoleSpy.mockRestore();
    });

    it('should route to Solana execution with chainConfig', async () => {
      vi.mocked(settlePayment).mockResolvedValue({
        status: 200,
        paymentReceipt: { transaction: 'SolanaTxSignature' },
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const mockReq = {
        method: 'POST',
        protocol: 'https',
        get: () => 'localhost',
        originalUrl: '/api/test',
      };

      const chainConfig = {
        chainId: 'solana-devnet',
        chainType: 'solana' as const,
        rpcUrl: 'https://api.devnet.solana.com',
        isActive: true,
        displayName: 'Solana Devnet',
      };

      const result = await service.executePaymentTransfer(
        'payment-data',
        mockReq,
        'SolanaTokenAddress',
        '1000000',
        'test-server',
        'test-api',
        'Test API',
        'solana',
        chainConfig
      );

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('SolanaTxSignature');
      consoleSpy.mockRestore();
    });
  });

  describe('extractUserAddress', () => {
    it('should extract EVM address (lowercased)', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: { from: '0xABCDEF' },
        },
      })).toString('base64');

      const result = service.extractUserAddress(paymentData, 'evm');

      expect(result).toBe('0xabcdef');
    });

    it('should extract Solana address (preserved case)', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: { from: 'SolanaWallet123ABC' },
        },
      })).toString('base64');

      const result = service.extractUserAddress(paymentData, 'solana');

      expect(result).toBe('SolanaWallet123ABC');
    });

    it('should return null for invalid data', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const result = service.extractUserAddress('invalid', 'evm');

      expect(result).toBeNull();
    });

    it('should return null for missing from field', async () => {
      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      const paymentData = Buffer.from(JSON.stringify({
        payload: {
          authorization: {},
        },
      })).toString('base64');

      const result = service.extractUserAddress(paymentData, 'evm');

      expect(result).toBeNull();
    });
  });

  describe('isInitialized', () => {
    it('should return true when initialized', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      expect(service.isInitialized()).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should return false when not initialized', async () => {
      delete process.env.THIRDWEB_SECRET_KEY;
      vi.resetModules();
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { MultiChainPaymentService } = await import('../src/services/multiChainPaymentService.js');
      const service = new MultiChainPaymentService();

      expect(service.isInitialized()).toBe(false);
      consoleSpy.mockRestore();
    });
  });
});
