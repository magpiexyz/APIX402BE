/**
 * Tests for Firestore Chain Config Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test data storage
let testData: Map<string, any> = new Map();
let shouldThrowError = false;

// Mock Firestore
vi.mock('../src/db/firestoreClient.js', () => {
  const createMockSnapshot = (docs: any[]) => ({
    empty: docs.length === 0,
    docs: docs.map((data) => ({
      id: data?.chainId,
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
          delete: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) throw new Error('Firestore error');
            testData.delete(key);
          }),
        };
      }),
      where: vi.fn().mockImplementation((field: string, op: string, value: any) => ({
        get: vi.fn().mockImplementation(async () => {
          if (shouldThrowError) throw new Error('Firestore error');
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
        if (shouldThrowError) throw new Error('Firestore error');
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
      CHAIN_CONFIGS: 'chain-configs',
    },
  };
});

import { ChainConfigService, type ChainConfigEntry, DEFAULT_CHAIN_CONFIGS } from '../src/services/firestoreChainConfigService.js';

describe('ChainConfigService', () => {
  let service: ChainConfigService;

  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;
    service = new ChainConfigService('us-west-1', 'chain-configs');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('DEFAULT_CHAIN_CONFIGS', () => {
    it('should have Base Sepolia config', () => {
      const baseSepolia = DEFAULT_CHAIN_CONFIGS.find(c => c.chainId === '84532');
      expect(baseSepolia).toBeDefined();
      expect(baseSepolia?.chainType).toBe('evm');
      expect(baseSepolia?.name).toBe('Base Sepolia');
    });

    it('should have Solana Devnet config', () => {
      const solanaDevnet = DEFAULT_CHAIN_CONFIGS.find(c => c.chainId === 'devnet');
      expect(solanaDevnet).toBeDefined();
      expect(solanaDevnet?.chainType).toBe('solana');
      expect(solanaDevnet?.name).toBe('Solana Devnet');
    });
  });

  describe('getChainConfig', () => {
    it('should return chain config when it exists', async () => {
      const config: ChainConfigEntry = {
        chainId: '84532',
        chainType: 'evm',
        name: 'Base Sepolia',
        shortName: 'Base',
        factoryAddress: '0xFactory',
        paymentTokenAddress: '0xUSDC',
        paymentTokenSymbol: 'USDC',
        paymentTokenDecimals: 6,
        rpcUrl: 'https://rpc.example.com',
        explorerUrl: 'https://explorer.example.com',
        explorerTxPath: '/tx/',
        explorerAddressPath: '/address/',
        enabled: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      testData.set('chain-configs/84532', config);

      const result = await service.getChainConfig('84532');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Base Sepolia');
    });

    it('should return null when chain config does not exist', async () => {
      const result = await service.getChainConfig('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getChainConfig('84532');

      expect(result).toBeNull();
    });
  });

  describe('getAllChains', () => {
    it('should return all chain configs', async () => {
      testData.set('chain-configs/84532', { chainId: '84532', name: 'Base Sepolia' });
      testData.set('chain-configs/devnet', { chainId: 'devnet', name: 'Solana Devnet' });

      const result = await service.getAllChains();

      expect(result).toHaveLength(2);
    });

    it('should return empty array when no configs', async () => {
      const result = await service.getAllChains();

      expect(result).toEqual([]);
    });

    it('should return empty array on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getAllChains();

      expect(result).toEqual([]);
    });
  });

  describe('getAllEnabledChains', () => {
    it('should return only enabled chains', async () => {
      testData.set('chain-configs/84532', { chainId: '84532', enabled: true });
      testData.set('chain-configs/devnet', { chainId: 'devnet', enabled: false });

      const result = await service.getAllEnabledChains();

      expect(result).toHaveLength(1);
      expect(result[0].enabled).toBe(true);
    });

    it('should return empty array on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getAllEnabledChains();

      expect(result).toEqual([]);
    });
  });

  describe('getChainsByType', () => {
    it('should return chains of specified type', async () => {
      testData.set('chain-configs/84532', { chainId: '84532', chainType: 'evm' });
      testData.set('chain-configs/devnet', { chainId: 'devnet', chainType: 'solana' });

      const evmResult = await service.getChainsByType('evm');
      expect(evmResult).toHaveLength(1);
      expect(evmResult[0].chainType).toBe('evm');

      const solanaResult = await service.getChainsByType('solana');
      expect(solanaResult).toHaveLength(1);
      expect(solanaResult[0].chainType).toBe('solana');
    });

    it('should return empty array on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getChainsByType('evm');

      expect(result).toEqual([]);
    });
  });

  describe('putChainConfig', () => {
    it('should save chain config', async () => {
      const config: ChainConfigEntry = {
        chainId: '84532',
        chainType: 'evm',
        name: 'Base Sepolia',
        shortName: 'Base',
        factoryAddress: '0xFactory',
        paymentTokenAddress: '0xUSDC',
        paymentTokenSymbol: 'USDC',
        paymentTokenDecimals: 6,
        rpcUrl: 'https://rpc.example.com',
        explorerUrl: 'https://explorer.example.com',
        explorerTxPath: '/tx/',
        explorerAddressPath: '/address/',
        enabled: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      await service.putChainConfig(config);

      const stored = testData.get('chain-configs/84532');
      expect(stored).toBeDefined();
      expect(stored.name).toBe('Base Sepolia');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      const config = { chainId: '84532' } as ChainConfigEntry;

      await expect(service.putChainConfig(config)).rejects.toThrow();
    });
  });

  describe('updateFactoryAddress', () => {
    it('should update factory address', async () => {
      testData.set('chain-configs/84532', { chainId: '84532', factoryAddress: '0xOld' });

      await service.updateFactoryAddress('84532', '0xNew');

      const stored = testData.get('chain-configs/84532');
      expect(stored.factoryAddress).toBe('0xNew');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.updateFactoryAddress('84532', '0xNew')).rejects.toThrow();
    });
  });

  describe('setChainEnabled', () => {
    it('should enable a chain', async () => {
      testData.set('chain-configs/84532', { chainId: '84532', enabled: false });

      await service.setChainEnabled('84532', true);

      const stored = testData.get('chain-configs/84532');
      expect(stored.enabled).toBe(true);
    });

    it('should disable a chain', async () => {
      testData.set('chain-configs/84532', { chainId: '84532', enabled: true });

      await service.setChainEnabled('84532', false);

      const stored = testData.get('chain-configs/84532');
      expect(stored.enabled).toBe(false);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.setChainEnabled('84532', true)).rejects.toThrow();
    });
  });

  describe('deleteChainConfig', () => {
    it('should delete chain config', async () => {
      testData.set('chain-configs/84532', { chainId: '84532' });

      await service.deleteChainConfig('84532');

      expect(testData.has('chain-configs/84532')).toBe(false);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.deleteChainConfig('84532')).rejects.toThrow();
    });
  });

  describe('seedDefaultConfigs', () => {
    it('should seed configs that do not exist', async () => {
      await service.seedDefaultConfigs();

      // Should have created entries for default configs
      expect(testData.size).toBeGreaterThan(0);
    });

    it('should skip configs that already exist', async () => {
      const existing = { chainId: '84532', name: 'Existing Config' };
      testData.set('chain-configs/84532', existing);

      await service.seedDefaultConfigs();

      // Existing config should not be overwritten
      const stored = testData.get('chain-configs/84532');
      expect(stored.name).toBe('Existing Config');
    });
  });

  describe('getTransactionUrl', () => {
    it('should return correct URL for EVM chains', () => {
      const config: ChainConfigEntry = {
        chainId: '84532',
        chainType: 'evm',
        explorerUrl: 'https://basescan.org',
        explorerTxPath: '/tx/',
      } as ChainConfigEntry;

      const url = service.getTransactionUrl(config, '0xTxHash');

      expect(url).toBe('https://basescan.org/tx/0xTxHash');
    });

    it('should return correct URL for Solana devnet', () => {
      const config: ChainConfigEntry = {
        chainId: 'devnet',
        chainType: 'solana',
        explorerUrl: 'https://explorer.solana.com',
        explorerTxPath: '/tx/',
      } as ChainConfigEntry;

      const url = service.getTransactionUrl(config, 'SolanaTxSignature');

      expect(url).toBe('https://explorer.solana.com/tx/SolanaTxSignature?cluster=devnet');
    });
  });

  describe('getAddressUrl', () => {
    it('should return correct URL for EVM chains', () => {
      const config: ChainConfigEntry = {
        chainId: '84532',
        chainType: 'evm',
        explorerUrl: 'https://basescan.org',
        explorerAddressPath: '/address/',
      } as ChainConfigEntry;

      const url = service.getAddressUrl(config, '0xAddress');

      expect(url).toBe('https://basescan.org/address/0xAddress');
    });

    it('should return correct URL for Solana devnet', () => {
      const config: ChainConfigEntry = {
        chainId: 'devnet',
        chainType: 'solana',
        explorerUrl: 'https://explorer.solana.com',
        explorerAddressPath: '/address/',
      } as ChainConfigEntry;

      const url = service.getAddressUrl(config, 'SolanaAddress');

      expect(url).toBe('https://explorer.solana.com/address/SolanaAddress?cluster=devnet');
    });
  });

  describe('isChainValid', () => {
    it('should return true for enabled chain', async () => {
      testData.set('chain-configs/84532', { chainId: '84532', enabled: true });

      const result = await service.isChainValid('84532');

      expect(result).toBe(true);
    });

    it('should return false for disabled chain', async () => {
      testData.set('chain-configs/84532', { chainId: '84532', enabled: false });

      const result = await service.isChainValid('84532');

      expect(result).toBe(false);
    });

    it('should return false for nonexistent chain', async () => {
      const result = await service.isChainValid('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('getChainConfigOrThrow', () => {
    it('should return config when chain exists and is enabled', async () => {
      testData.set('chain-configs/84532', { chainId: '84532', enabled: true, name: 'Base' });

      const result = await service.getChainConfigOrThrow('84532');

      expect(result.name).toBe('Base');
    });

    it('should throw when chain not found', async () => {
      await expect(service.getChainConfigOrThrow('nonexistent')).rejects.toThrow('Chain nonexistent not found');
    });

    it('should throw when chain is disabled', async () => {
      testData.set('chain-configs/84532', { chainId: '84532', enabled: false });

      await expect(service.getChainConfigOrThrow('84532')).rejects.toThrow('Chain 84532 is currently disabled');
    });
  });
});
