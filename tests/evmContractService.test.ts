/**
 * Tests for EVM Contract Service
 * Uses viem for direct RPC calls — no Thirdweb dependency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock for viem's readContract (called as this.client.readContract)
const mockReadContract = vi.fn();

// Mock viem — createPublicClient returns an object with our mockReadContract
vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({
    readContract: mockReadContract,
  })),
  http: vi.fn(),
}));

// Mock viem/chains
vi.mock('viem/chains', () => ({
  baseSepolia: { id: 84532, name: 'Base Sepolia' },
}));

// Mock fs for ABI loading
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(() => JSON.stringify([
      { name: 'graduationThreshold', type: 'function', inputs: [], outputs: [{ type: 'uint256' }] },
      { name: 'totalTokensDistributed', type: 'function', inputs: [], outputs: [{ type: 'uint256' }] },
      { name: 'totalFeesCollected', type: 'function', inputs: [], outputs: [{ type: 'uint256' }] },
      { name: 'liquidityDeployed', type: 'function', inputs: [], outputs: [{ type: 'bool' }] },
      { name: 'paymentTokenPrice', type: 'function', inputs: [], outputs: [{ type: 'uint256' }] },
      { name: 'paymentTokenDecimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }] },
      { name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }] },
      { name: 'name', type: 'function', inputs: [], outputs: [{ type: 'string' }] },
      { name: 'paymentTokenInfo', type: 'function', inputs: [], outputs: [{ type: 'tuple' }] },
    ])),
  },
}));

import { createPublicClient } from 'viem';

describe('EVMContractService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockReset();
  });

  describe('constructor', () => {
    it('should initialize viem client with default RPC URL', async () => {
      vi.resetModules();
      const { EVMContractService } = await import('../src/services/evmContractService.js');
      new EVMContractService('0xFactoryAddress');
      expect(createPublicClient).toHaveBeenCalled();
    });

    it('should use RPC_URL env var when set', async () => {
      vi.resetModules();
      const savedRpc = process.env.RPC_URL;
      process.env.RPC_URL = 'https://custom-rpc.example.com';
      const { http } = await import('viem');
      const { EVMContractService } = await import('../src/services/evmContractService.js');
      new EVMContractService('0xFactoryAddress');
      expect(http).toHaveBeenCalledWith('https://custom-rpc.example.com');
      process.env.RPC_URL = savedRpc;
    });
  });

  describe('getTokenMetrics', () => {
    it('should return token metrics when successful', async () => {
      // Promise.all order: graduationThreshold, totalTokensDistributed, totalFeesCollected,
      //                    liquidityDeployed, paymentTokenPrice, paymentTokenDecimals
      mockReadContract
        .mockResolvedValueOnce(BigInt('1000000000000000000000')) // graduationThreshold
        .mockResolvedValueOnce(BigInt('500000000000000000000'))  // totalTokensDistributed (50%)
        .mockResolvedValueOnce(BigInt('1000000'))                // totalFeesCollected
        .mockResolvedValueOnce(false)                            // liquidityDeployed
        .mockResolvedValueOnce(BigInt('1000000'))                // paymentTokenPrice
        .mockResolvedValueOnce(6);                               // paymentTokenDecimals

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getTokenMetrics('0xTokenAddress');

      expect(result).not.toBeNull();
      expect(result?.tokenAddress).toBe('0xtokenaddress');
      expect(result?.bondingProgress).toBe(50);
      expect(result?.isGraduated).toBe(false);
      expect(result?.liquidityDeployed).toBe(false);
      expect(result?.paymentTokenDecimals).toBe(6);
    });

    it('should calculate bonding progress correctly at 100%', async () => {
      mockReadContract
        .mockResolvedValueOnce(BigInt('1000'))  // graduationThreshold
        .mockResolvedValueOnce(BigInt('1000'))  // totalTokensDistributed (100%)
        .mockResolvedValueOnce(BigInt('100'))   // totalFeesCollected
        .mockResolvedValueOnce(true)            // liquidityDeployed
        .mockResolvedValueOnce(BigInt('1'))     // paymentTokenPrice
        .mockResolvedValueOnce(0);              // paymentTokenDecimals

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getTokenMetrics('0xTokenAddress');

      expect(result?.bondingProgress).toBe(100);
      expect(result?.isGraduated).toBe(true);
    });

    it('should cap bonding progress at 100%', async () => {
      mockReadContract
        .mockResolvedValueOnce(BigInt('1000'))  // graduationThreshold
        .mockResolvedValueOnce(BigInt('1500'))  // totalTokensDistributed (over threshold)
        .mockResolvedValueOnce(BigInt('100'))   // totalFeesCollected
        .mockResolvedValueOnce(true)            // liquidityDeployed
        .mockResolvedValueOnce(BigInt('1'))     // paymentTokenPrice
        .mockResolvedValueOnce(0);              // paymentTokenDecimals

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getTokenMetrics('0xTokenAddress');

      expect(result?.bondingProgress).toBe(100);
    });

    it('should return null on contract read error', async () => {
      mockReadContract.mockRejectedValue(new Error('Contract error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getTokenMetrics('0xTokenAddress');

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe('getFactoryInfo', () => {
    it('should return factory info when successful', async () => {
      mockReadContract.mockResolvedValue(['0xPaymentTokenAddress', BigInt('1000000'), 6]);

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getFactoryInfo();

      expect(result).not.toBeNull();
      expect(result?.factoryAddress).toBe('0xFactoryAddress');
      expect(result?.paymentToken).toBe('0xPaymentTokenAddress');
      expect(result?.paymentTokenDecimals).toBe(6);
    });

    it('should return null on contract read error', async () => {
      mockReadContract.mockRejectedValue(new Error('Contract error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getFactoryInfo();

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe('tokenExists', () => {
    it('should return true when token exists', async () => {
      mockReadContract.mockResolvedValue('TEST');

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.tokenExists('0xTokenAddress');

      expect(result).toBe(true);
    });

    it('should return false when token does not exist', async () => {
      mockReadContract.mockRejectedValue(new Error('Token not found'));

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.tokenExists('0xInvalidToken');

      expect(result).toBe(false);
    });
  });

  describe('getTokenSymbol', () => {
    it('should return symbol when successful', async () => {
      mockReadContract.mockResolvedValue('TEST');

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getTokenSymbol('0xTokenAddress');

      expect(result).toBe('TEST');
    });

    it('should return null on error', async () => {
      mockReadContract.mockRejectedValue(new Error('Read error'));

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getTokenSymbol('0xTokenAddress');

      expect(result).toBeNull();
    });
  });

  describe('getTokenName', () => {
    it('should return name when successful', async () => {
      mockReadContract.mockResolvedValue('Test Token');

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getTokenName('0xTokenAddress');

      expect(result).toBe('Test Token');
    });

    it('should return null on error', async () => {
      mockReadContract.mockRejectedValue(new Error('Read error'));

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getTokenName('0xTokenAddress');

      expect(result).toBeNull();
    });
  });

  describe('getPaymentTokenDomain', () => {
    it('should return name and version from eip712Domain()', async () => {
      // eip712Domain returns: [fields, name, version, chainId, verifyingContract, salt, extensions]
      mockReadContract.mockResolvedValue([
        '0x0f', 'USD Coin', '2', BigInt(84532), '0xUSDC', '0x00', [],
      ]);

      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getPaymentTokenDomain('0xUSDC');

      expect(result.name).toBe('USD Coin');
      expect(result.version).toBe('2');
    });

    it('should fall back to name() + version "2" when eip712Domain not supported', async () => {
      mockReadContract
        .mockRejectedValueOnce(new Error('function not found')) // eip712Domain fails
        .mockResolvedValueOnce('USD Coin');                     // name() succeeds

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getPaymentTokenDomain('0xUSDC');

      expect(result.name).toBe('USD Coin');
      expect(result.version).toBe('2');
      consoleSpy.mockRestore();
    });

    it('should return hardcoded fallback when both calls fail', async () => {
      mockReadContract.mockRejectedValue(new Error('not supported'));

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');
      const result = await service.getPaymentTokenDomain('0xUnknown');

      expect(result.name).toBe('USD Coin');
      expect(result.version).toBe('2');
      consoleSpy.mockRestore();
    });
  });

  describe('calculateTokenAmount', () => {
    it('should calculate token amount correctly', async () => {
      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      // fee=1000000 (1 USDC), price=1000000, decimals=6
      // (1000000 * 1000000) / 10^6 = 1000000 tokens
      const result = service.calculateTokenAmount(BigInt('1000000'), BigInt('1000000'), 6);
      expect(result).toBe(BigInt('1000000'));
    });

    it('should handle different decimal values', async () => {
      const { EVMContractService } = await import('../src/services/evmContractService.js');
      const service = new EVMContractService('0xFactoryAddress');

      // fee=1e18 (1 ETH), price=2000, decimals=18
      // (1e18 * 2000) / 10^18 = 2000 tokens
      const result = service.calculateTokenAmount(
        BigInt('1000000000000000000'),
        BigInt('2000'),
        18
      );
      expect(result).toBe(BigInt('2000'));
    });
  });
});
