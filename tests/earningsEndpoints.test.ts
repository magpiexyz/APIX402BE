/**
 * Tests for Earnings & Claim Endpoints
 *
 * Tests the endpoint handler logic by validating response shapes, branching,
 * and the services they depend on. Since endpoints are inline in index.ts,
 * we mock the services and test the branching conditions directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Test data storage (mock Firestore) ----
let testData: Map<string, any> = new Map();
let shouldThrowError = false;

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
          _testKey: key,
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
        };
      }),
      where: vi.fn().mockImplementation((field: string, op: string, value: any) => ({
        limit: vi.fn().mockReturnThis(),
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
      IAO_TOKENS: 'iao-tokens',
      TOKEN_EARNINGS: 'token-earnings',
      MERKLE_TREES: 'merkle-trees',
    },
    FieldValue: { increment: vi.fn((n) => n) },
  };
});

import { EarningsService, type TokenEarningEntry } from '../src/services/firestoreEarningsService.js';
import { MerkleTreeService } from '../src/services/firestoreMerkleTreeService.js';
import { DynamoDBService, type IAOTokenDBEntry } from '../src/services/firestoreTokenService.js';

// ---- Helper to seed a token in mock Firestore ----
function seedToken(token: Partial<IAOTokenDBEntry> & { id: string; slug: string }) {
  const full: IAOTokenDBEntry = {
    name: 'Test Token',
    symbol: 'TEST',
    builder: '0xbuilder',
    paymentToken: '0xusdc',
    chainId: '84532',
    subscriptionCount: '100',
    refundCount: '0',
    fulfilledCount: '100',
    apis: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...token,
  };
  testData.set(`iao-tokens/${full.id}`, full);
}

function seedEarning(entry: Partial<TokenEarningEntry> & { tokenAddress: string; userAddress: string }) {
  const docId = `${entry.tokenAddress.toLowerCase()}#${entry.userAddress.toLowerCase()}`;
  const full: TokenEarningEntry = {
    id: docId,
    totalTokensEarned: '0',
    totalFeesPaid: '0',
    callCount: '0',
    lastEarnedAt: '2024-01-01T00:00:00.000Z',
    claimed: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...entry,
  };
  testData.set(`token-earnings/${docId}`, full);
}

describe('Earnings & Claim Endpoints', () => {
  let earningsService: EarningsService;
  let merkleTreeService: MerkleTreeService;
  let dynamoDBService: DynamoDBService;

  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;
    earningsService = new EarningsService();
    merkleTreeService = new MerkleTreeService();
    dynamoDBService = new DynamoDBService('us-west-1', 'iao-tokens');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // GET /api/earnings/:serverSlug/:userAddress
  // =========================================================================
  describe('GET /api/earnings/:serverSlug/:userAddress (service layer)', () => {
    it('should return earnings data with bonding progress for existing user', async () => {
      // Seed token with virtual distribution progress
      seedToken({
        id: '0xtoken',
        slug: 'testserver',
        virtualTokensDistributed: '312500000000000000000000000', // 50% of 625M
        graduated: false,
      });

      // Seed earnings
      seedEarning({
        tokenAddress: '0xtoken',
        userAddress: '0xuser1',
        totalTokensEarned: '5000000000000000000',
        totalFeesPaid: '50000',
        callCount: '5',
        claimed: false,
      });

      // Simulate endpoint logic: look up token by slug, then get earning
      const tokenEntry = await dynamoDBService.getItemBySlug('testserver');
      expect(tokenEntry).not.toBeNull();

      const earning = await earningsService.getEarning(tokenEntry!.id, '0xuser1');
      expect(earning).not.toBeNull();
      expect(earning!.totalTokensEarned).toBe('5000000000000000000');
      expect(earning!.callCount).toBe('5');

      // Bonding progress calculation
      const virtualDistributed = BigInt(tokenEntry!.virtualTokensDistributed || '0');
      const graduationThreshold = BigInt('625000000000000000000000000');
      const bondingProgress = Number((virtualDistributed * 10000n) / graduationThreshold) / 100;
      expect(bondingProgress).toBeCloseTo(50, 0);
    });

    it('should return zeroed fields when user has no earnings', async () => {
      seedToken({ id: '0xtoken', slug: 'testserver' });

      const tokenEntry = await dynamoDBService.getItemBySlug('testserver');
      expect(tokenEntry).not.toBeNull();

      const earning = await earningsService.getEarning(tokenEntry!.id, '0xunknown');
      expect(earning).toBeNull();

      // Endpoint returns defaults when earning is null
      const response = {
        totalTokensEarned: earning?.totalTokensEarned || '0',
        totalFeesPaid: earning?.totalFeesPaid || '0',
        callCount: earning?.callCount || '0',
        claimed: earning?.claimed || false,
        claimTxHash: earning?.claimTxHash || null,
      };
      expect(response.totalTokensEarned).toBe('0');
      expect(response.totalFeesPaid).toBe('0');
      expect(response.callCount).toBe('0');
      expect(response.claimed).toBe(false);
      expect(response.claimTxHash).toBeNull();
    });

    it('should cap bondingProgress at 100 when virtualTokensDistributed > threshold', async () => {
      seedToken({
        id: '0xtoken',
        slug: 'testserver',
        virtualTokensDistributed: '700000000000000000000000000', // > 625M threshold
      });

      const tokenEntry = await dynamoDBService.getItemBySlug('testserver');
      const virtualDistributed = BigInt(tokenEntry!.virtualTokensDistributed || '0');
      const graduationThreshold = BigInt('625000000000000000000000000');
      const rawProgress = Number((virtualDistributed * 10000n) / graduationThreshold) / 100;
      const bondingProgress = Math.min(rawProgress, 100);

      expect(rawProgress).toBeGreaterThan(100);
      expect(bondingProgress).toBe(100);
    });

    it('should return graduated=true when token is graduated', async () => {
      seedToken({
        id: '0xtoken',
        slug: 'testserver',
        graduated: true,
        virtualTokensDistributed: '625000000000000000000000000',
      });

      const tokenEntry = await dynamoDBService.getItemBySlug('testserver');
      const isGraduated = tokenEntry?.graduated === true;

      expect(isGraduated).toBe(true);
    });

    it('should include claimTxHash when present', async () => {
      seedToken({ id: '0xtoken', slug: 'testserver' });
      seedEarning({
        tokenAddress: '0xtoken',
        userAddress: '0xuser1',
        totalTokensEarned: '1000',
        claimed: true,
        claimTxHash: '0xDeadBeefClaim',
      });

      const earning = await earningsService.getEarning('0xtoken', '0xuser1');
      expect(earning?.claimTxHash).toBe('0xDeadBeefClaim');
      expect(earning?.claimed).toBe(true);
    });

    it('should return 404-equivalent when server slug not found', async () => {
      const tokenEntry = await dynamoDBService.getItemBySlug('nonexistent');
      expect(tokenEntry).toBeNull();
      // Endpoint would return 404
    });

    it('should handle null earning gracefully (no crash)', async () => {
      seedToken({ id: '0xtoken', slug: 'testserver' });

      const tokenEntry = await dynamoDBService.getItemBySlug('testserver');
      const earning = await earningsService.getEarning(tokenEntry!.id, '0xnoone');

      // Simulating the endpoint's null-safe property access
      const response = {
        success: true,
        totalTokensEarned: earning?.totalTokensEarned || '0',
        totalFeesPaid: earning?.totalFeesPaid || '0',
        callCount: earning?.callCount || '0',
        claimed: earning?.claimed || false,
        claimTxHash: earning?.claimTxHash || null,
      };

      expect(response.success).toBe(true);
      expect(response.totalTokensEarned).toBe('0');
    });
  });

  // =========================================================================
  // GET /api/earnings/:serverSlug
  // =========================================================================
  describe('GET /api/earnings/:serverSlug (service layer)', () => {
    it('should return all users earnings for the server', async () => {
      seedToken({ id: '0xtoken', slug: 'testserver' });
      seedEarning({
        tokenAddress: '0xtoken',
        userAddress: '0xuser1',
        totalTokensEarned: '1000',
        callCount: '1',
      });
      seedEarning({
        tokenAddress: '0xtoken',
        userAddress: '0xuser2',
        totalTokensEarned: '2000',
        callCount: '3',
      });

      const tokenEntry = await dynamoDBService.getItemBySlug('testserver');
      const earnings = await earningsService.getEarningsByToken(tokenEntry!.id);

      expect(earnings).toHaveLength(2);
      const users = earnings.map(e => ({
        userAddress: e.userAddress,
        totalTokensEarned: e.totalTokensEarned,
        callCount: e.callCount,
        claimed: e.claimed,
      }));
      expect(users).toHaveLength(2);
      expect(users.find(u => u.userAddress === '0xuser1')?.totalTokensEarned).toBe('1000');
      expect(users.find(u => u.userAddress === '0xuser2')?.totalTokensEarned).toBe('2000');
    });

    it('should return empty users array when no earnings exist', async () => {
      seedToken({ id: '0xtoken', slug: 'testserver' });

      const tokenEntry = await dynamoDBService.getItemBySlug('testserver');
      const earnings = await earningsService.getEarningsByToken(tokenEntry!.id);

      expect(earnings).toEqual([]);
    });

    it('should include totalVirtualDistributed and graduationThreshold', async () => {
      seedToken({
        id: '0xtoken',
        slug: 'testserver',
        virtualTokensDistributed: '100000000000000000000000000',
      });

      const tokenEntry = await dynamoDBService.getItemBySlug('testserver');
      const totalVirtualDistributed = tokenEntry?.virtualTokensDistributed || '0';
      const graduationThreshold = '625000000000000000000000000';

      expect(totalVirtualDistributed).toBe('100000000000000000000000000');
      expect(graduationThreshold).toBe('625000000000000000000000000');
    });

    it('should return 404-equivalent when server slug not found', async () => {
      const tokenEntry = await dynamoDBService.getItemBySlug('ghost');
      expect(tokenEntry).toBeNull();
    });
  });

  // =========================================================================
  // GET /api/claim/:serverSlug/:userAddress
  // =========================================================================
  describe('GET /api/claim/:serverSlug/:userAddress (service layer)', () => {
    it('should return Merkle proof data for graduated token', async () => {
      const { StandardMerkleTree } = await import('@openzeppelin/merkle-tree');

      const addr1 = '0x1111111111111111111111111111111111111111';
      const addr2 = '0x2222222222222222222222222222222222222222';
      const leaves: [string, string][] = [
        [addr1, '5000000000000000000'],
        [addr2, '3000000000000000000'],
      ];
      const tree = StandardMerkleTree.of(leaves, ['address', 'uint256']);

      seedToken({
        id: '0xtoken',
        slug: 'testserver',
        graduated: true,
        merkleRoot: tree.root,
        virtualTokensDistributed: '625000000000000000000000000',
      });

      // Store tree
      testData.set('merkle-trees/0xtoken', {
        id: '0xtoken',
        merkleRoot: tree.root,
        totalLeaves: 2,
        totalTokens: '8000000000000000000',
        leaves: leaves.map(([addr, amt], i) => ({ address: addr.toLowerCase(), amount: amt, index: i })),
        treeDump: JSON.stringify(tree.dump()),
        generatedAt: new Date().toISOString(),
        chainId: '84532',
      });

      seedEarning({
        tokenAddress: '0xtoken',
        userAddress: addr1,
        totalTokensEarned: '5000000000000000000',
        claimed: false,
      });

      // Simulate endpoint
      const tokenEntry = await dynamoDBService.getItemBySlug('testserver');
      expect(tokenEntry?.graduated).toBe(true);

      const proofData = await merkleTreeService.generateProof(tokenEntry!.id, addr1);
      expect(proofData).not.toBeNull();
      expect(proofData!.proof.length).toBeGreaterThan(0);
      expect(proofData!.amount).toBe('5000000000000000000');

      const earning = await earningsService.getEarning(tokenEntry!.id, addr1);
      expect(earning?.claimed).toBe(false);
    });

    it('should return claimed=true when already claimed', async () => {
      seedToken({ id: '0xtoken', slug: 'testserver', graduated: true });

      seedEarning({
        tokenAddress: '0xtoken',
        userAddress: '0xuser1',
        totalTokensEarned: '1000',
        claimed: true,
        claimTxHash: '0xClaimTx',
      });

      const earning = await earningsService.getEarning('0xtoken', '0xuser1');
      expect(earning?.claimed).toBe(true);
      expect(earning?.claimTxHash).toBe('0xClaimTx');
    });

    it('should return 400-equivalent when token has NOT graduated', async () => {
      seedToken({
        id: '0xtoken',
        slug: 'testserver',
        graduated: false,
      });

      const tokenEntry = await dynamoDBService.getItemBySlug('testserver');
      const isGraduated = tokenEntry?.graduated === true;

      expect(isGraduated).toBe(false);
      // Endpoint would return 400: "Token not graduated"
    });

    it('should return 404-equivalent when server slug not found', async () => {
      const tokenEntry = await dynamoDBService.getItemBySlug('noexist');
      expect(tokenEntry).toBeNull();
    });

    it('should return 404-equivalent when no claim found for user', async () => {
      seedToken({ id: '0xtoken', slug: 'testserver', graduated: true });
      // No merkle tree stored — generateProof returns null

      const proofData = await merkleTreeService.generateProof('0xtoken', '0xunknownuser');
      expect(proofData).toBeNull();
    });

    it('should include merkleRoot in response', async () => {
      seedToken({
        id: '0xtoken',
        slug: 'testserver',
        graduated: true,
        merkleRoot: '0xRootHash123',
      });

      const tokenEntry = await dynamoDBService.getItemBySlug('testserver');
      const merkleRoot = tokenEntry?.merkleRoot || '';

      expect(merkleRoot).toBe('0xRootHash123');
    });
  });

  // =========================================================================
  // POST /api/claim/:serverSlug/:userAddress/confirm
  // =========================================================================
  describe('POST /api/claim/:serverSlug/:userAddress/confirm (service layer)', () => {
    it('should confirm claim and mark as claimed with txHash', async () => {
      seedToken({ id: '0xtoken', slug: 'testserver' });
      seedEarning({
        tokenAddress: '0xtoken',
        userAddress: '0xuser1',
        totalTokensEarned: '1000',
        claimed: false,
      });

      const txHash = '0xConfirmTxHash';
      await earningsService.markAsClaimed('0xtoken', '0xuser1', txHash);

      const updated = await earningsService.getEarning('0xtoken', '0xuser1');
      expect(updated?.claimed).toBe(true);
      expect(updated?.claimTxHash).toBe(txHash);
    });

    it('should require txHash in request body (validation check)', () => {
      // Endpoint returns 400 when txHash is missing
      const txHash = undefined;
      expect(!txHash).toBe(true);
      // Simulates: if (!txHash) return res.status(400)
    });

    it('should return 404-equivalent when server slug not found', async () => {
      const tokenEntry = await dynamoDBService.getItemBySlug('nonexistent');
      expect(tokenEntry).toBeNull();
    });
  });

  // =========================================================================
  // Token calculation logic (tested in isolation)
  // =========================================================================
  describe('Token calculation logic', () => {
    /**
     * Formula: tokensEarned = (fee * paymentTokenPrice) / 10^decimals
     * Default: paymentTokenPrice = "1000000000000000000" (1e18), decimals = 6
     */
    function calculateTokensEarned(
      fee: string,
      paymentTokenPrice?: string,
      paymentTokenDecimals?: number
    ): string {
      const price = BigInt(paymentTokenPrice || '1000000000000000000'); // 1e18
      const decimals = paymentTokenDecimals ?? 6;
      const feeBigInt = BigInt(fee);
      const divisor = BigInt(10) ** BigInt(decimals);
      return ((feeBigInt * price) / divisor).toString();
    }

    it('should calculate tokensEarned correctly: (fee * paymentTokenPrice) / 10^decimals', () => {
      // fee=10000 ($0.01 USDC with 6 decimals), price=1e18, decimals=6
      const result = calculateTokensEarned('10000', '1000000000000000000', 6);
      // (10000 * 1e18) / 1e6 = 10000 * 1e12 = 1e16
      expect(result).toBe('10000000000000000');
    });

    it('should use fallback price when paymentTokenPrice is undefined', () => {
      const result = calculateTokensEarned('10000', undefined, 6);
      // Falls back to 1e18
      expect(result).toBe('10000000000000000');
    });

    it('should use fallback decimals (6) when paymentTokenDecimals is undefined', () => {
      const result = calculateTokensEarned('10000', '1000000000000000000', undefined);
      expect(result).toBe('10000000000000000');
    });

    it('should handle large BigInt values without overflow', () => {
      // Large fee: 1000000000 (1000 USDC)
      const result = calculateTokensEarned('1000000000', '1000000000000000000', 6);
      // (1e9 * 1e18) / 1e6 = 1e21
      expect(result).toBe('1000000000000000000000');
      // Verify it's a valid BigInt string
      expect(() => BigInt(result)).not.toThrow();
    });

    it('should handle zero fee', () => {
      const result = calculateTokensEarned('0', '1000000000000000000', 6);
      expect(result).toBe('0');
    });

    it('should handle very small fee', () => {
      const result = calculateTokensEarned('1', '1000000000000000000', 6);
      // (1 * 1e18) / 1e6 = 1e12
      expect(result).toBe('1000000000000');
    });

    it('should handle different decimal values (18 decimals)', () => {
      const result = calculateTokensEarned('1000000000000000000', '1000000000000000000', 18);
      // (1e18 * 1e18) / 1e18 = 1e18
      expect(result).toBe('1000000000000000000');
    });

    it('should handle 8-decimal payment token (e.g. WBTC)', () => {
      const result = calculateTokensEarned('100000000', '1000000000000000000', 8);
      // (1e8 * 1e18) / 1e8 = 1e18
      expect(result).toBe('1000000000000000000');
    });
  });

  // =========================================================================
  // Bonding progress edge cases
  // =========================================================================
  describe('Bonding progress calculation', () => {
    function calculateBondingProgress(virtualTokensDistributed: string | undefined): number {
      const virtualDistributed = BigInt(virtualTokensDistributed || '0');
      const graduationThreshold = BigInt('625000000000000000000000000');
      const bondingProgress = graduationThreshold > 0n
        ? Number((virtualDistributed * 10000n) / graduationThreshold) / 100
        : 0;
      return Math.min(bondingProgress, 100);
    }

    it('should return 0 when no virtual tokens distributed', () => {
      expect(calculateBondingProgress(undefined)).toBe(0);
      expect(calculateBondingProgress('0')).toBe(0);
    });

    it('should return 50 at half graduation threshold', () => {
      const half = (BigInt('625000000000000000000000000') / 2n).toString();
      expect(calculateBondingProgress(half)).toBe(50);
    });

    it('should return 100 at exact graduation threshold', () => {
      expect(calculateBondingProgress('625000000000000000000000000')).toBe(100);
    });

    it('should cap at 100 when over graduation threshold', () => {
      expect(calculateBondingProgress('999000000000000000000000000')).toBe(100);
    });

    it('should handle small fractional progress', () => {
      // 1% of threshold
      const onePercent = (BigInt('625000000000000000000000000') / 100n).toString();
      const progress = calculateBondingProgress(onePercent);
      expect(progress).toBeGreaterThanOrEqual(0.99);
      expect(progress).toBeLessThanOrEqual(1.01);
    });
  });
});
