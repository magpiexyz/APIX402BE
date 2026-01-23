/**
 * Tests for EVM Contract Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock environment variables
const originalEnv = process.env;

// Mock thirdweb SDK
vi.mock('thirdweb', () => ({
  createThirdwebClient: vi.fn(() => ({ secretKey: 'mock-key' })),
  getContract: vi.fn(() => ({})),
  readContract: vi.fn(),
}));

// Mock thirdweb chains
vi.mock('thirdweb/chains', () => ({
  baseSepolia: { id: 84532, name: 'Base Sepolia' },
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(() => JSON.stringify([
      { name: 'graduationThreshold', type: 'function', inputs: [], outputs: [{ type: 'uint256' }] },
      { name: 'totalTokensDistributed', type: 'function', inputs: [], outputs: [{ type: 'uint256' }] },
    ])),
  },
}));

import { createThirdwebClient, getContract, readContract } from 'thirdweb';

describe('EVMContractService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.THIRDWEB_SECRET_KEY = 'test-secret-key';
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize client when secret key is set', async () => {
      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      expect(createThirdwebClient).toHaveBeenCalled();
    });

    it('should warn when secret key is not set', async () => {
      delete process.env.THIRDWEB_SECRET_KEY;
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.resetModules();
      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('THIRDWEB_SECRET_KEY not set'));
      consoleSpy.mockRestore();
    });
  });

  describe('getTokenMetrics', () => {
    it('should return null when client not initialized', async () => {
      delete process.env.THIRDWEB_SECRET_KEY;
      vi.resetModules();

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getTokenMetrics('0xTokenAddress');
      expect(result).toBeNull();
    });

    it('should return token metrics when successful', async () => {
      vi.mocked(readContract)
        .mockResolvedValueOnce(BigInt('1000000000000000000000')) // graduationThreshold
        .mockResolvedValueOnce(BigInt('500000000000000000000'))  // totalTokensDistributed
        .mockResolvedValueOnce(BigInt('1000000'))               // totalFeesCollected
        .mockResolvedValueOnce(BigInt('1000000'))               // paymentTokenPrice
        .mockResolvedValueOnce(6);                               // paymentTokenDecimals

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getTokenMetrics('0xTokenAddress');

      expect(result).not.toBeNull();
      expect(result?.tokenAddress).toBe('0xtokenaddress');
      expect(result?.bondingProgress).toBe(50);
      expect(result?.isGraduated).toBe(false);
    });

    it('should calculate bonding progress correctly at 100%', async () => {
      vi.mocked(readContract)
        .mockResolvedValueOnce(BigInt('1000'))  // graduationThreshold
        .mockResolvedValueOnce(BigInt('1000'))  // totalTokensDistributed (equal = graduated)
        .mockResolvedValueOnce(BigInt('100'))   // totalFeesCollected
        .mockResolvedValueOnce(BigInt('1'))     // paymentTokenPrice
        .mockResolvedValueOnce(0);              // paymentTokenDecimals

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getTokenMetrics('0xTokenAddress');

      expect(result?.bondingProgress).toBe(100);
      expect(result?.isGraduated).toBe(true);
    });

    it('should cap bonding progress at 100%', async () => {
      vi.mocked(readContract)
        .mockResolvedValueOnce(BigInt('1000'))  // graduationThreshold
        .mockResolvedValueOnce(BigInt('1500'))  // totalTokensDistributed (over threshold)
        .mockResolvedValueOnce(BigInt('100'))   // totalFeesCollected
        .mockResolvedValueOnce(BigInt('1'))     // paymentTokenPrice
        .mockResolvedValueOnce(0);              // paymentTokenDecimals

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getTokenMetrics('0xTokenAddress');

      expect(result?.bondingProgress).toBe(100);
    });

    it('should return null on contract read error', async () => {
      vi.mocked(readContract).mockRejectedValue(new Error('Contract error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getTokenMetrics('0xTokenAddress');

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe('getFactoryInfo', () => {
    it('should return null when client not initialized', async () => {
      delete process.env.THIRDWEB_SECRET_KEY;
      vi.resetModules();

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getFactoryInfo();
      expect(result).toBeNull();
    });

    it('should return factory info when successful', async () => {
      vi.mocked(readContract).mockResolvedValue([
        '0xPaymentTokenAddress',
        BigInt('1000000'),
        6,
      ]);

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getFactoryInfo();

      expect(result).not.toBeNull();
      expect(result?.factoryAddress).toBe('0xFactoryAddress');
      expect(result?.paymentToken).toBe('0xPaymentTokenAddress');
      expect(result?.paymentTokenDecimals).toBe(6);
    });

    it('should return null on contract read error', async () => {
      vi.mocked(readContract).mockRejectedValue(new Error('Contract error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getFactoryInfo();

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe('tokenExists', () => {
    it('should return false when client not initialized', async () => {
      delete process.env.THIRDWEB_SECRET_KEY;
      vi.resetModules();

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.tokenExists('0xTokenAddress');
      expect(result).toBe(false);
    });

    it('should return true when token exists', async () => {
      vi.mocked(readContract).mockResolvedValue('TEST');

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.tokenExists('0xTokenAddress');
      expect(result).toBe(true);
    });

    it('should return false when token does not exist', async () => {
      vi.mocked(readContract).mockRejectedValue(new Error('Token not found'));

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.tokenExists('0xInvalidToken');
      expect(result).toBe(false);
    });
  });

  describe('getTokenSymbol', () => {
    it('should return null when client not initialized', async () => {
      delete process.env.THIRDWEB_SECRET_KEY;
      vi.resetModules();

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getTokenSymbol('0xTokenAddress');
      expect(result).toBeNull();
    });

    it('should return symbol when successful', async () => {
      vi.mocked(readContract).mockResolvedValue('TEST');

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getTokenSymbol('0xTokenAddress');
      expect(result).toBe('TEST');
    });

    it('should return null on error', async () => {
      vi.mocked(readContract).mockRejectedValue(new Error('Read error'));

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getTokenSymbol('0xTokenAddress');
      expect(result).toBeNull();
    });
  });

  describe('getTokenName', () => {
    it('should return null when client not initialized', async () => {
      delete process.env.THIRDWEB_SECRET_KEY;
      vi.resetModules();

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getTokenName('0xTokenAddress');
      expect(result).toBeNull();
    });

    it('should return name when successful', async () => {
      vi.mocked(readContract).mockResolvedValue('Test Token');

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getTokenName('0xTokenAddress');
      expect(result).toBe('Test Token');
    });

    it('should return null on error', async () => {
      vi.mocked(readContract).mockRejectedValue(new Error('Read error'));

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      const result = await service.getTokenName('0xTokenAddress');
      expect(result).toBeNull();
    });
  });

  describe('calculateTokenAmount', () => {
    it('should calculate token amount correctly', async () => {
      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      // fee=1000000 (1 USDC), price=1000000, decimals=6
      // (1000000 * 1000000) / 1000000 = 1000000 tokens
      const result = service.calculateTokenAmount(
        BigInt('1000000'),
        BigInt('1000000'),
        6
      );

      expect(result).toBe(BigInt('1000000'));
    });

    it('should handle different decimal values', async () => {
      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      // fee=1000000000000000000 (1 ETH), price=2000, decimals=18
      const result = service.calculateTokenAmount(
        BigInt('1000000000000000000'),
        BigInt('2000'),
        18
      );

      expect(result).toBe(BigInt('2000'));
    });
  });
});
