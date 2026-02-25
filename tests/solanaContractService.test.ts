/**
 * Tests for Solana Contract Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock account info result
let mockAccountInfo: any = null;
let mockGetAccountInfoError = false;

/**
 * Helper to create Borsh-encoded token state data
 */
function createMockTokenStateData(options: {
  serverSlug?: string;
  name?: string;
  symbol?: string;
  graduationThreshold?: bigint;
  totalTokensDistributed?: bigint;
  totalFeesCollected?: bigint;
  isGraduated?: boolean;
  hasPoolAddress?: boolean;
  createdAt?: bigint;
} = {}) {
  const {
    serverSlug = 'test-server',
    name = 'Test Token',
    symbol = 'TEST',
    graduationThreshold = BigInt('1000000000000000000000'),
    totalTokensDistributed = BigInt('500000000000000000000'),
    totalFeesCollected = BigInt('1000000'),
    isGraduated = false,
    hasPoolAddress = false,
    createdAt = BigInt(Date.now()),
  } = options;

  const parts: Buffer[] = [];

  // Anchor discriminator (8 bytes)
  parts.push(Buffer.alloc(8));

  // String fields (4 bytes length + content)
  const writeString = (str: string) => {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(str.length, 0);
    parts.push(lenBuf);
    parts.push(Buffer.from(str, 'utf-8'));
  };

  writeString(serverSlug);
  writeString(name);
  writeString(symbol);

  // Pubkeys (32 bytes each)
  parts.push(Buffer.alloc(32)); // mint
  parts.push(Buffer.alloc(32)); // builder
  parts.push(Buffer.alloc(32)); // factory

  // U64 fields (8 bytes each, little-endian)
  const writeU64 = (value: bigint) => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(value, 0);
    parts.push(buf);
  };

  writeU64(graduationThreshold);
  writeU64(totalTokensDistributed);
  writeU64(totalFeesCollected);

  // Bool fields (1 byte each)
  parts.push(Buffer.from([isGraduated ? 1 : 0]));
  parts.push(Buffer.from([hasPoolAddress ? 1 : 0]));

  // Pool address (32 bytes)
  parts.push(Buffer.alloc(32));

  // I64 fields (8 bytes each, little-endian)
  const writeI64 = (value: bigint) => {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64LE(value, 0);
    parts.push(buf);
  };

  writeI64(createdAt);      // createdAt
  writeI64(createdAt);      // updatedAt

  // Bump fields (1 byte each)
  parts.push(Buffer.from([255])); // bump
  parts.push(Buffer.from([254])); // mintAuthorityBump

  return Buffer.concat(parts);
}

/**
 * Helper to create Borsh-encoded factory state data
 */
function createMockFactoryStateData(options: {
  paymentTokenPrice?: bigint;
  paymentTokenDecimals?: number;
  totalTokensCreated?: bigint;
} = {}) {
  const {
    paymentTokenPrice = BigInt('1000000'),
    paymentTokenDecimals = 6,
    totalTokensCreated = BigInt(5),
  } = options;

  const parts: Buffer[] = [];

  // Anchor discriminator (8 bytes)
  parts.push(Buffer.alloc(8));

  // Pubkeys (32 bytes each)
  parts.push(Buffer.alloc(32)); // admin
  parts.push(Buffer.alloc(32)); // automationWallet
  parts.push(Buffer.alloc(32)); // paymentTokenMint

  // paymentTokenPrice (u64, 8 bytes)
  const priceBuf = Buffer.alloc(8);
  priceBuf.writeBigUInt64LE(paymentTokenPrice, 0);
  parts.push(priceBuf);

  // paymentTokenDecimals (u8, 1 byte)
  parts.push(Buffer.from([paymentTokenDecimals]));

  // totalTokensCreated (u64, 8 bytes)
  const countBuf = Buffer.alloc(8);
  countBuf.writeBigUInt64LE(totalTokensCreated, 0);
  parts.push(countBuf);

  // bump (u8, 1 byte)
  parts.push(Buffer.from([255]));

  return Buffer.concat(parts);
}

// Mock @solana/web3.js
vi.mock('@solana/web3.js', () => {
  class MockPublicKey {
    private _key: string;

    constructor(key: any) {
      if (typeof key === 'string' && key.length < 32 && key !== 'invalid') {
        throw new Error('Invalid public key');
      }
      this._key = typeof key === 'string' ? key : 'MockPubkeyBase58';
    }

    toBase58() {
      return this._key;
    }

    static findProgramAddressSync = vi.fn(() => [
      { toBase58: () => 'DerivedPDAAddress' },
      255,
    ]);
  }

  class MockConnection {
    constructor(_url: string, _commitment?: string) {}

    async getAccountInfo(_pubkey: any) {
      if (mockGetAccountInfoError) {
        throw new Error('Connection error');
      }
      return mockAccountInfo;
    }
  }

  return {
    Connection: MockConnection,
    PublicKey: MockPublicKey,
  };
});

import { Connection, PublicKey } from '@solana/web3.js';

describe('SolanaContractService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    mockAccountInfo = null;
    mockGetAccountInfoError = false;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    mockAccountInfo = null;
    mockGetAccountInfoError = false;
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default RPC URL', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      // Verify service is created and logs initialization
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Solana Contract Service initialized'));
      consoleSpy.mockRestore();
    });

    it('should initialize with custom RPC URL', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService('https://custom-rpc.com');

      // Service should initialize without error
      expect(service).toBeDefined();
      consoleSpy.mockRestore();
    });
  });

  describe('PDA derivation', () => {
    it('should derive factory state PDA', async () => {
      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const [pda, bump] = service.getFactoryStatePDA();

      expect(PublicKey.findProgramAddressSync).toHaveBeenCalled();
      expect(pda.toBase58()).toBe('DerivedPDAAddress');
    });

    it('should derive token state PDA', async () => {
      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const [pda, bump] = service.getTokenStatePDA('test-server');

      expect(PublicKey.findProgramAddressSync).toHaveBeenCalled();
    });

    it('should derive mint PDA', async () => {
      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const [pda, bump] = service.getMintPDA('test-server');

      expect(PublicKey.findProgramAddressSync).toHaveBeenCalled();
    });
  });

  describe('getTokenMetrics', () => {
    it('should return null when account not found', async () => {
      mockAccountInfo = null;

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.getTokenMetrics('nonexistent-server');

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('should return token metrics when account exists', async () => {
      mockAccountInfo = {
        data: createMockTokenStateData({
          serverSlug: 'test-server',
          name: 'Test Token',
          symbol: 'TEST',
          graduationThreshold: BigInt('1000'),
          totalTokensDistributed: BigInt('500'),
          totalFeesCollected: BigInt('100'),
          isGraduated: false,
          hasPoolAddress: false,
          createdAt: BigInt(1700000000000),
        }),
      };

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.getTokenMetrics('test-server');

      expect(result).not.toBeNull();
      expect(result?.serverSlug).toBe('test-server');
      expect(result?.graduationThreshold).toBe('1000');
      expect(result?.totalTokensDistributed).toBe('500');
      expect(result?.totalFeesCollected).toBe('100');
      expect(result?.bondingProgress).toBe(50);
      expect(result?.isGraduated).toBe(false);
      expect(result?.poolAddress).toBeNull();
      consoleSpy.mockRestore();
    });

    it('should return metrics with graduated token and pool address', async () => {
      mockAccountInfo = {
        data: createMockTokenStateData({
          graduationThreshold: BigInt('1000'),
          totalTokensDistributed: BigInt('1000'),
          isGraduated: true,
          hasPoolAddress: true,
        }),
      };

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.getTokenMetrics('test-server');

      expect(result?.bondingProgress).toBe(100);
      expect(result?.isGraduated).toBe(true);
      expect(result?.poolAddress).toBeDefined();
      consoleSpy.mockRestore();
    });

    it('should cap bonding progress at 100%', async () => {
      mockAccountInfo = {
        data: createMockTokenStateData({
          graduationThreshold: BigInt('1000'),
          totalTokensDistributed: BigInt('1500'), // Over threshold
        }),
      };

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.getTokenMetrics('test-server');

      expect(result?.bondingProgress).toBe(100);
      consoleSpy.mockRestore();
    });

    it('should handle zero graduation threshold', async () => {
      mockAccountInfo = {
        data: createMockTokenStateData({
          graduationThreshold: BigInt('0'),
          totalTokensDistributed: BigInt('100'),
        }),
      };

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.getTokenMetrics('test-server');

      expect(result?.bondingProgress).toBe(0);
      consoleSpy.mockRestore();
    });

    it('should return null on error', async () => {
      mockGetAccountInfoError = true;

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.getTokenMetrics('test-server');

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to get Solana token metrics'), expect.any(String));
      consoleSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  describe('getTokenMetricsByMint', () => {
    it('should return null and warn', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const result = await service.getTokenMetricsByMint('SomeMintAddress');

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('requires server slug'));
      consoleSpy.mockRestore();
    });
  });

  describe('getFactoryInfo', () => {
    it('should return null when factory not initialized', async () => {
      mockAccountInfo = null;

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.getFactoryInfo();

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('should return factory info when initialized', async () => {
      mockAccountInfo = {
        data: createMockFactoryStateData({
          paymentTokenPrice: BigInt('1000000'),
          paymentTokenDecimals: 6,
          totalTokensCreated: BigInt(10),
        }),
      };

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.getFactoryInfo();

      expect(result).not.toBeNull();
      expect(result?.paymentTokenPrice).toBe('1000000');
      expect(result?.paymentTokenDecimals).toBe(6);
      expect(result?.totalTokensCreated).toBe(10);
      expect(result?.programId).toBeDefined();
      expect(result?.admin).toBeDefined();
      expect(result?.automationWallet).toBeDefined();
      expect(result?.paymentTokenMint).toBeDefined();
      consoleSpy.mockRestore();
    });

    it('should return null on error', async () => {
      mockGetAccountInfoError = true;

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.getFactoryInfo();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to get Solana factory info'), expect.any(String));
      consoleSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  describe('tokenExists', () => {
    it('should return true when account exists', async () => {
      mockAccountInfo = { data: Buffer.alloc(100) };

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.tokenExists('test-server');

      expect(result).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should return false when account not found', async () => {
      mockAccountInfo = null;

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.tokenExists('nonexistent');

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });

    it('should return false on error', async () => {
      mockGetAccountInfoError = true;

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.tokenExists('test-server');

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('factoryInitialized', () => {
    it('should return true when factory exists', async () => {
      mockAccountInfo = { data: Buffer.alloc(100) };

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.factoryInitialized();

      expect(result).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should return false when factory not found', async () => {
      mockAccountInfo = null;

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.factoryInitialized();

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });

    it('should return false on error', async () => {
      mockGetAccountInfoError = true;

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await service.factoryInitialized();

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('address utilities', () => {
    it('should return mint address', async () => {
      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const result = service.getMintAddress('test-server');

      expect(result).toBe('DerivedPDAAddress');
    });

    it('should return token state address', async () => {
      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const result = service.getTokenStateAddress('test-server');

      expect(result).toBe('DerivedPDAAddress');
    });
  });

  describe('calculateTokenAmount', () => {
    it('should calculate token amount correctly for USDC (6 decimals)', async () => {
      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      // 1 USDC = 1_000_000 (6 decimals)
      // Token amount = fee * 10^(18-6) = 1_000_000 * 10^12 = 1_000_000_000_000_000_000
      const result = service.calculateTokenAmount(BigInt('1000000'), 6);

      expect(result).toBe(BigInt('1000000000000000000'));
    });

    it('should calculate token amount correctly for SOL (9 decimals)', async () => {
      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      // 1 SOL = 1_000_000_000 (9 decimals)
      // Token amount = fee * 10^(18-9) = 1_000_000_000 * 10^9
      const result = service.calculateTokenAmount(BigInt('1000000000'), 9);

      expect(result).toBe(BigInt('1000000000000000000'));
    });
  });

  describe('getConnection', () => {
    it('should return the connection instance', async () => {
      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const connection = service.getConnection();

      expect(connection).toBeDefined();
    });
  });

  describe('getProgramId', () => {
    it('should return the program ID', async () => {
      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const service = new SolanaContractService();

      const programId = service.getProgramId();

      expect(programId).toBeDefined();
    });
  });

  describe('isValidAddress', () => {
    it('should return true for valid 32-byte address', async () => {
      // A proper Solana address is 32 bytes, encoded as base58
      const validAddress = '11111111111111111111111111111111'; // System Program (32 chars)

      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      const result = SolanaContractService.isValidAddress(validAddress);

      expect(result).toBe(true);
    });

    it('should return false for address that is too short', async () => {
      const { SolanaContractService } = await import('../src/services/solanaContractService.js');
      // Our mock throws for strings shorter than 32 chars (except 'invalid')
      const result = SolanaContractService.isValidAddress('short');

      expect(result).toBe(false);
    });
  });
});
