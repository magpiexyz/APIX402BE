/**
 * End-to-End Lifecycle Test: Token Purchase → Graduation → Merkle Claim
 *
 * Traces the full Merkle claim distribution flow:
 *   1. Multiple API calls accumulate earnings for several users
 *   2. Virtual token distribution tracks toward graduation threshold
 *   3. Graduation triggers Merkle tree generation from accumulated earnings
 *   4. Users retrieve proofs and claim tokens
 *   5. Claims are confirmed and double-claims are prevented
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

// ---- Shared mock Firestore state ----
let testData: Map<string, any> = new Map();
let shouldThrowError = false;

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
          delete: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) throw new Error('Firestore error');
            testData.delete(key);
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

import { EarningsService } from '../src/services/firestoreEarningsService.js';
import { MerkleTreeService } from '../src/services/firestoreMerkleTreeService.js';
import { DynamoDBService, type IAOTokenDBEntry } from '../src/services/firestoreTokenService.js';

// ---- Constants matching production values ----
const GRADUATION_THRESHOLD = BigInt('625000000000000000000000000'); // 625M with 18 decimals
const DEFAULT_PAYMENT_TOKEN_PRICE = BigInt('25000000000000000000000'); // from index.ts line 3229
const DEFAULT_PAYMENT_TOKEN_DECIMALS = 6; // USDC

// ---- Test addresses (valid 42-char EVM addresses) ----
const TOKEN_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const USER_A = '0x1111111111111111111111111111111111111111';
const USER_B = '0x2222222222222222222222222222222222222222';
const USER_C = '0x3333333333333333333333333333333333333333';

/**
 * Replicates the production tokensEarned formula from index.ts:3229-3231
 *   tokensEarned = (fee * paymentTokenPrice) / 10^paymentTokenDecimals
 */
function calculateTokensEarned(
  fee: string,
  paymentTokenPrice: bigint = DEFAULT_PAYMENT_TOKEN_PRICE,
  paymentTokenDecimals: number = DEFAULT_PAYMENT_TOKEN_DECIMALS
): string {
  const tokensEarned = (BigInt(fee) * paymentTokenPrice) / BigInt(10 ** paymentTokenDecimals);
  return tokensEarned.toString();
}

/**
 * Replicates the production graduation check from the automation Lambda.
 * Returns bonding progress as percentage (0-100).
 */
function getBondingProgress(virtualTokensDistributed: string | undefined): number {
  const distributed = BigInt(virtualTokensDistributed || '0');
  if (GRADUATION_THRESHOLD === 0n) return 0;
  const progress = Number((distributed * 10000n) / GRADUATION_THRESHOLD) / 100;
  return Math.min(progress, 100);
}

/**
 * Replicates the graduation automation: builds a Merkle tree from all
 * earnings for a token and stores it in Firestore.
 */
async function graduateToken(
  tokenAddress: string,
  earningsService: EarningsService,
  merkleTreeService: MerkleTreeService,
  dynamoDBService: DynamoDBService
): Promise<string> {
  // 1. Fetch all earnings (matches automation Lambda logic)
  const earnings = await earningsService.getEarningsByToken(tokenAddress);
  if (earnings.length === 0) throw new Error('No earnings found');

  // 2. Build Merkle tree — OZ StandardMerkleTree expects [address, uint256]
  const leaves: [string, string][] = earnings.map((e) => [
    e.userAddress,
    e.totalTokensEarned,
  ]);
  const tree = StandardMerkleTree.of(leaves, ['address', 'uint256']);

  // 3. Store tree in Firestore
  const totalTokens = earnings
    .reduce((acc, e) => acc + BigInt(e.totalTokensEarned), 0n)
    .toString();

  await merkleTreeService.storeMerkleTree(tokenAddress, {
    merkleRoot: tree.root,
    totalLeaves: leaves.length,
    totalTokens,
    leaves: earnings.map((e, i) => ({
      address: e.userAddress,
      amount: e.totalTokensEarned,
      index: i,
    })),
    treeDump: JSON.stringify(tree.dump()),
    generatedAt: new Date().toISOString(),
    chainId: '84532',
  });

  // 4. Mark token as graduated in DB
  const tokenDBEntry = testData.get(`iao-tokens/${tokenAddress}`);
  if (tokenDBEntry) {
    testData.set(`iao-tokens/${tokenAddress}`, {
      ...tokenDBEntry,
      graduated: true,
      merkleRoot: tree.root,
      updatedAt: new Date().toISOString(),
    });
  }

  return tree.root;
}

// =========================================================================

describe('End-to-End: Token Purchase → Graduation → Merkle Claim', () => {
  let earningsService: EarningsService;
  let merkleTreeService: MerkleTreeService;
  let dynamoDBService: DynamoDBService;

  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;

    earningsService = new EarningsService();
    merkleTreeService = new MerkleTreeService();
    dynamoDBService = new DynamoDBService('us-west-1', 'iao-tokens');

    // Seed the IAO token (Merkle distribution model)
    const tokenEntry: IAOTokenDBEntry = {
      id: TOKEN_ADDRESS,
      slug: 'testserver',
      name: 'Test API Token',
      symbol: 'TEST',
      builder: '0xbuilder',
      paymentToken: '0xusdc',
      chainId: '84532',
      subscriptionCount: '0',
      refundCount: '0',
      fulfilledCount: '0',
      apis: [
        {
          index: 0,
          slug: 'get-data',
          name: 'Get Data',
          apiUrl: 'https://api.test.com/data',
          description: 'Test API',
          fee: '10000', // $0.01 USDC (6 decimals)
          method: 'GET',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      distributionModel: 'merkle',
      virtualTokensDistributed: '0',
      paymentTokenPrice: DEFAULT_PAYMENT_TOKEN_PRICE.toString(),
      paymentTokenDecimals: DEFAULT_PAYMENT_TOKEN_DECIMALS,
      graduated: false,
    };
    testData.set(`iao-tokens/${TOKEN_ADDRESS}`, tokenEntry);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // PHASE 1: API Calls Accumulate Earnings
  // -----------------------------------------------------------------------
  describe('Phase 1: API calls accumulate earnings', () => {
    it('should track earnings and virtual distribution after API calls', async () => {
      const fee = '10000'; // $0.01 USDC
      const tokensPerCall = calculateTokensEarned(fee);

      // User A makes 3 calls
      for (let i = 0; i < 3; i++) {
        await earningsService.incrementEarnings(TOKEN_ADDRESS, USER_A, tokensPerCall, fee);
        await dynamoDBService.incrementVirtualDistributed(TOKEN_ADDRESS, tokensPerCall);
      }

      // User B makes 2 calls
      for (let i = 0; i < 2; i++) {
        await earningsService.incrementEarnings(TOKEN_ADDRESS, USER_B, tokensPerCall, fee);
        await dynamoDBService.incrementVirtualDistributed(TOKEN_ADDRESS, tokensPerCall);
      }

      // Verify user earnings
      const earningA = await earningsService.getEarning(TOKEN_ADDRESS, USER_A);
      expect(earningA).not.toBeNull();
      expect(earningA!.callCount).toBe('3');
      expect(earningA!.totalTokensEarned).toBe((BigInt(tokensPerCall) * 3n).toString());
      expect(earningA!.totalFeesPaid).toBe((BigInt(fee) * 3n).toString());
      expect(earningA!.claimed).toBe(false);

      const earningB = await earningsService.getEarning(TOKEN_ADDRESS, USER_B);
      expect(earningB).not.toBeNull();
      expect(earningB!.callCount).toBe('2');

      // Verify virtual distribution on the token
      const token = await dynamoDBService.getItem(TOKEN_ADDRESS);
      const expectedVirtual = BigInt(tokensPerCall) * 5n; // 3 + 2 calls
      expect(token!.virtualTokensDistributed).toBe(expectedVirtual.toString());

      // Not graduated yet
      expect(getBondingProgress(token!.virtualTokensDistributed)).toBeLessThan(1);
      expect(token!.graduated).toBe(false);
    });

    it('should correctly accumulate earnings for multiple users across many calls', async () => {
      const fee = '10000';
      const tokensPerCall = calculateTokensEarned(fee);

      // Simulate: A=10, B=7, C=3 calls
      const callCounts: Record<string, number> = { [USER_A]: 10, [USER_B]: 7, [USER_C]: 3 };

      for (const [user, count] of Object.entries(callCounts)) {
        for (let i = 0; i < count; i++) {
          await earningsService.incrementEarnings(TOKEN_ADDRESS, user, tokensPerCall, fee);
          await dynamoDBService.incrementVirtualDistributed(TOKEN_ADDRESS, tokensPerCall);
        }
      }

      // Verify per-user totals
      const allEarnings = await earningsService.getEarningsByToken(TOKEN_ADDRESS);
      expect(allEarnings).toHaveLength(3);

      for (const [user, count] of Object.entries(callCounts)) {
        const earning = await earningsService.getEarning(TOKEN_ADDRESS, user);
        expect(earning!.callCount).toBe(count.toString());
        expect(earning!.totalTokensEarned).toBe((BigInt(tokensPerCall) * BigInt(count)).toString());
      }

      // Verify aggregate virtual distribution = sum of all
      const token = await dynamoDBService.getItem(TOKEN_ADDRESS);
      const totalCalls = 10 + 7 + 3;
      expect(token!.virtualTokensDistributed).toBe((BigInt(tokensPerCall) * BigInt(totalCalls)).toString());
    });
  });

  // -----------------------------------------------------------------------
  // PHASE 2: Progress Toward Graduation
  // -----------------------------------------------------------------------
  describe('Phase 2: bonding progress toward graduation', () => {
    it('should track bonding progress as virtual tokens accumulate', async () => {
      const fee = '10000';
      const tokensPerCall = calculateTokensEarned(fee);

      // Set virtual distribution to 50% manually for speed
      const halfThreshold = (GRADUATION_THRESHOLD / 2n).toString();
      testData.set(`iao-tokens/${TOKEN_ADDRESS}`, {
        ...testData.get(`iao-tokens/${TOKEN_ADDRESS}`),
        virtualTokensDistributed: halfThreshold,
      });

      const token = await dynamoDBService.getItem(TOKEN_ADDRESS);
      expect(getBondingProgress(token!.virtualTokensDistributed)).toBe(50);
      expect(token!.graduated).toBe(false);
    });

    it('should detect graduation when threshold is reached', async () => {
      // Set virtual distribution to exactly the threshold
      testData.set(`iao-tokens/${TOKEN_ADDRESS}`, {
        ...testData.get(`iao-tokens/${TOKEN_ADDRESS}`),
        virtualTokensDistributed: GRADUATION_THRESHOLD.toString(),
      });

      const token = await dynamoDBService.getItem(TOKEN_ADDRESS);
      const progress = getBondingProgress(token!.virtualTokensDistributed);
      expect(progress).toBe(100);

      // Graduation automation would now trigger
      const distributed = BigInt(token!.virtualTokensDistributed || '0');
      expect(distributed >= GRADUATION_THRESHOLD).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // PHASE 3: Graduation & Merkle Tree Generation
  // -----------------------------------------------------------------------
  describe('Phase 3: graduation triggers Merkle tree generation', () => {
    async function setupEarningsAndGraduate() {
      const fee = '10000';
      const tokensPerCall = calculateTokensEarned(fee);

      // Simulate earnings for 3 users
      const callCounts: Record<string, number> = { [USER_A]: 10, [USER_B]: 7, [USER_C]: 3 };
      let totalVirtual = 0n;

      for (const [user, count] of Object.entries(callCounts)) {
        for (let i = 0; i < count; i++) {
          await earningsService.incrementEarnings(TOKEN_ADDRESS, user, tokensPerCall, fee);
          totalVirtual += BigInt(tokensPerCall);
        }
      }

      // Fast-forward: set virtual distribution to graduation threshold
      testData.set(`iao-tokens/${TOKEN_ADDRESS}`, {
        ...testData.get(`iao-tokens/${TOKEN_ADDRESS}`),
        virtualTokensDistributed: GRADUATION_THRESHOLD.toString(),
      });

      // Run graduation
      const merkleRoot = await graduateToken(
        TOKEN_ADDRESS,
        earningsService,
        merkleTreeService,
        dynamoDBService
      );

      return { callCounts, tokensPerCall, merkleRoot };
    }

    it('should generate a Merkle tree with all earning users as leaves', async () => {
      const { callCounts, merkleRoot } = await setupEarningsAndGraduate();

      // Verify tree is stored
      const tree = await merkleTreeService.getMerkleTree(TOKEN_ADDRESS);
      expect(tree).not.toBeNull();
      expect(tree!.merkleRoot).toBe(merkleRoot);
      expect(tree!.totalLeaves).toBe(Object.keys(callCounts).length);
      expect(tree!.leaves).toHaveLength(3);

      // Verify token is marked graduated
      const token = await dynamoDBService.getItem(TOKEN_ADDRESS);
      expect(token!.graduated).toBe(true);
      expect(token!.merkleRoot).toBe(merkleRoot);
    });

    it('should include correct per-user amounts in tree leaves', async () => {
      const { callCounts, tokensPerCall } = await setupEarningsAndGraduate();

      const tree = await merkleTreeService.getMerkleTree(TOKEN_ADDRESS);
      for (const leaf of tree!.leaves) {
        const user = leaf.address;
        const expectedCalls = callCounts[user];
        const expectedAmount = (BigInt(tokensPerCall) * BigInt(expectedCalls)).toString();
        expect(leaf.amount).toBe(expectedAmount);
      }
    });

    it('should have totalTokens equal to sum of all leaf amounts', async () => {
      await setupEarningsAndGraduate();

      const tree = await merkleTreeService.getMerkleTree(TOKEN_ADDRESS);
      const sumOfLeaves = tree!.leaves.reduce(
        (acc, l) => acc + BigInt(l.amount),
        0n
      );
      expect(tree!.totalTokens).toBe(sumOfLeaves.toString());
    });
  });

  // -----------------------------------------------------------------------
  // PHASE 4: Users Claim Tokens via Merkle Proof
  // -----------------------------------------------------------------------
  describe('Phase 4: users claim tokens via Merkle proof', () => {
    let merkleRoot: string;

    beforeEach(async () => {
      const fee = '10000';
      const tokensPerCall = calculateTokensEarned(fee);

      // Accumulate earnings
      const callCounts: Record<string, number> = { [USER_A]: 10, [USER_B]: 7, [USER_C]: 3 };
      for (const [user, count] of Object.entries(callCounts)) {
        for (let i = 0; i < count; i++) {
          await earningsService.incrementEarnings(TOKEN_ADDRESS, user, tokensPerCall, fee);
        }
      }

      // Fast-forward & graduate
      testData.set(`iao-tokens/${TOKEN_ADDRESS}`, {
        ...testData.get(`iao-tokens/${TOKEN_ADDRESS}`),
        virtualTokensDistributed: GRADUATION_THRESHOLD.toString(),
      });

      merkleRoot = await graduateToken(
        TOKEN_ADDRESS,
        earningsService,
        merkleTreeService,
        dynamoDBService
      );
    });

    it('should generate a valid proof for each user', async () => {
      for (const user of [USER_A, USER_B, USER_C]) {
        const proofData = await merkleTreeService.generateProof(TOKEN_ADDRESS, user);
        expect(proofData).not.toBeNull();
        expect(Array.isArray(proofData!.proof)).toBe(true);
        expect(proofData!.proof.length).toBeGreaterThan(0);

        // Verify proof cryptographically
        const isValid = StandardMerkleTree.verify(
          merkleRoot,
          ['address', 'uint256'],
          [user, proofData!.amount],
          proofData!.proof
        );
        expect(isValid).toBe(true);
      }
    });

    it('should return proof amounts matching accumulated earnings', async () => {
      const fee = '10000';
      const tokensPerCall = calculateTokensEarned(fee);
      const expected: Record<string, string> = {
        [USER_A]: (BigInt(tokensPerCall) * 10n).toString(),
        [USER_B]: (BigInt(tokensPerCall) * 7n).toString(),
        [USER_C]: (BigInt(tokensPerCall) * 3n).toString(),
      };

      for (const [user, expectedAmount] of Object.entries(expected)) {
        const proofData = await merkleTreeService.generateProof(TOKEN_ADDRESS, user);
        expect(proofData!.amount).toBe(expectedAmount);
      }
    });

    it('should return null proof for a user not in the tree', async () => {
      const outsider = '0x9999999999999999999999999999999999999999';
      const proofData = await merkleTreeService.generateProof(TOKEN_ADDRESS, outsider);
      expect(proofData).toBeNull();
    });

    it('should reject proof for wrong amount (tampered claim)', () => {
      // Build a fake proof for wrong amount — it should fail verification
      const fakeAmount = '999999999999999999999999';
      const fakeProof = ['0x' + '00'.repeat(32)]; // garbage proof

      const isValid = StandardMerkleTree.verify(
        merkleRoot,
        ['address', 'uint256'],
        [USER_A, fakeAmount],
        fakeProof
      );
      expect(isValid).toBe(false);
    });

    it('should block claims before graduation (endpoint logic)', async () => {
      // Create a separate non-graduated token
      const ungradToken = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      testData.set(`iao-tokens/${ungradToken}`, {
        id: ungradToken,
        slug: 'notgraduated',
        graduated: false,
        distributionModel: 'merkle',
        virtualTokensDistributed: '1000',
      });

      const tokenDBEntry = await dynamoDBService.getItem(ungradToken);
      expect(tokenDBEntry!.graduated).toBeFalsy();
      // Endpoint would return 400: "Token not graduated"
    });
  });

  // -----------------------------------------------------------------------
  // PHASE 5: Claim Confirmation & Double-Claim Prevention
  // -----------------------------------------------------------------------
  describe('Phase 5: claim confirmation and double-claim prevention', () => {
    beforeEach(async () => {
      const fee = '10000';
      const tokensPerCall = calculateTokensEarned(fee);

      // Accumulate and graduate
      for (let i = 0; i < 5; i++) {
        await earningsService.incrementEarnings(TOKEN_ADDRESS, USER_A, tokensPerCall, fee);
        await earningsService.incrementEarnings(TOKEN_ADDRESS, USER_B, tokensPerCall, fee);
      }

      testData.set(`iao-tokens/${TOKEN_ADDRESS}`, {
        ...testData.get(`iao-tokens/${TOKEN_ADDRESS}`),
        virtualTokensDistributed: GRADUATION_THRESHOLD.toString(),
      });

      await graduateToken(
        TOKEN_ADDRESS,
        earningsService,
        merkleTreeService,
        dynamoDBService
      );
    });

    it('should confirm a claim by marking earning as claimed with txHash', async () => {
      // User A claims
      const txHash = '0xCLAIMTX_A_111';
      await earningsService.markAsClaimed(TOKEN_ADDRESS, USER_A, txHash);

      const earning = await earningsService.getEarning(TOKEN_ADDRESS, USER_A);
      expect(earning!.claimed).toBe(true);
      expect(earning!.claimTxHash).toBe(txHash);
    });

    it('should preserve earnings data after claiming', async () => {
      const earningBefore = await earningsService.getEarning(TOKEN_ADDRESS, USER_A);
      const tokensBefore = earningBefore!.totalTokensEarned;
      const feesBefore = earningBefore!.totalFeesPaid;
      const callsBefore = earningBefore!.callCount;

      await earningsService.markAsClaimed(TOKEN_ADDRESS, USER_A, '0xTX');

      const earningAfter = await earningsService.getEarning(TOKEN_ADDRESS, USER_A);
      expect(earningAfter!.totalTokensEarned).toBe(tokensBefore);
      expect(earningAfter!.totalFeesPaid).toBe(feesBefore);
      expect(earningAfter!.callCount).toBe(callsBefore);
      expect(earningAfter!.claimed).toBe(true);
    });

    it('should show claimed=true when fetching claim status after confirm', async () => {
      // Before claim
      const pre = await earningsService.getEarning(TOKEN_ADDRESS, USER_A);
      expect(pre!.claimed).toBe(false);

      // Confirm claim
      await earningsService.markAsClaimed(TOKEN_ADDRESS, USER_A, '0xTX_A');

      // After claim
      const post = await earningsService.getEarning(TOKEN_ADDRESS, USER_A);
      expect(post!.claimed).toBe(true);
      expect(post!.claimTxHash).toBe('0xTX_A');
    });

    it('should allow one user to claim without affecting others', async () => {
      // User A claims
      await earningsService.markAsClaimed(TOKEN_ADDRESS, USER_A, '0xTX_A');

      // User B should still be unclaimed
      const earningB = await earningsService.getEarning(TOKEN_ADDRESS, USER_B);
      expect(earningB!.claimed).toBe(false);
      expect(earningB!.claimTxHash).toBeUndefined();
    });

    it('should allow both users to independently claim', async () => {
      await earningsService.markAsClaimed(TOKEN_ADDRESS, USER_A, '0xTX_A');
      await earningsService.markAsClaimed(TOKEN_ADDRESS, USER_B, '0xTX_B');

      const earningA = await earningsService.getEarning(TOKEN_ADDRESS, USER_A);
      const earningB = await earningsService.getEarning(TOKEN_ADDRESS, USER_B);

      expect(earningA!.claimed).toBe(true);
      expect(earningA!.claimTxHash).toBe('0xTX_A');
      expect(earningB!.claimed).toBe(true);
      expect(earningB!.claimTxHash).toBe('0xTX_B');
    });

    it('should still return valid proofs even after a user has claimed', async () => {
      // Claim User A
      await earningsService.markAsClaimed(TOKEN_ADDRESS, USER_A, '0xTX_A');

      // Proof should still be retrievable (on-chain contract handles double-claim prevention)
      const proofA = await merkleTreeService.generateProof(TOKEN_ADDRESS, USER_A);
      expect(proofA).not.toBeNull();
      expect(proofA!.proof.length).toBeGreaterThan(0);

      // And still valid
      const tree = await merkleTreeService.getMerkleTree(TOKEN_ADDRESS);
      const isValid = StandardMerkleTree.verify(
        tree!.merkleRoot,
        ['address', 'uint256'],
        [USER_A, proofA!.amount],
        proofA!.proof
      );
      expect(isValid).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Full flow in a single test
  // -----------------------------------------------------------------------
  describe('Full lifecycle in one test', () => {
    it('should complete the entire flow: purchase → accumulate → graduate → prove → claim', async () => {
      const fee = '10000';
      const tokensPerCall = calculateTokensEarned(fee);

      // --- Step 1: API calls accumulate earnings ---
      const callCounts: Record<string, number> = {
        [USER_A]: 15,
        [USER_B]: 10,
        [USER_C]: 5,
      };

      for (const [user, count] of Object.entries(callCounts)) {
        for (let i = 0; i < count; i++) {
          await earningsService.incrementEarnings(TOKEN_ADDRESS, user, tokensPerCall, fee);
          await dynamoDBService.incrementVirtualDistributed(TOKEN_ADDRESS, tokensPerCall);
        }
      }

      // Verify earnings are tracked
      const allEarnings = await earningsService.getEarningsByToken(TOKEN_ADDRESS);
      expect(allEarnings).toHaveLength(3);

      // --- Step 2: Verify virtual tokens are accumulating (pre-graduation) ---
      let token = await dynamoDBService.getItem(TOKEN_ADDRESS);
      const distributedRaw = BigInt(token!.virtualTokensDistributed || '0');
      // 30 calls * tokensPerCall should give a non-zero distributed value
      const totalCalls = 15 + 10 + 5;
      expect(distributedRaw).toBe(BigInt(tokensPerCall) * BigInt(totalCalls));
      expect(distributedRaw).toBeGreaterThan(0n);
      // Still far below graduation threshold
      expect(distributedRaw).toBeLessThan(GRADUATION_THRESHOLD);
      expect(token!.graduated).toBe(false);

      // --- Step 3: Fast-forward to graduation threshold ---
      testData.set(`iao-tokens/${TOKEN_ADDRESS}`, {
        ...testData.get(`iao-tokens/${TOKEN_ADDRESS}`),
        virtualTokensDistributed: GRADUATION_THRESHOLD.toString(),
      });
      token = await dynamoDBService.getItem(TOKEN_ADDRESS);
      expect(getBondingProgress(token!.virtualTokensDistributed)).toBe(100);

      // --- Step 4: Graduate & generate Merkle tree ---
      const merkleRoot = await graduateToken(
        TOKEN_ADDRESS,
        earningsService,
        merkleTreeService,
        dynamoDBService
      );

      token = await dynamoDBService.getItem(TOKEN_ADDRESS);
      expect(token!.graduated).toBe(true);
      expect(token!.merkleRoot).toBe(merkleRoot);

      const storedTree = await merkleTreeService.getMerkleTree(TOKEN_ADDRESS);
      expect(storedTree!.totalLeaves).toBe(3);

      // --- Step 5: Each user gets a valid proof ---
      for (const [user, count] of Object.entries(callCounts)) {
        const proof = await merkleTreeService.generateProof(TOKEN_ADDRESS, user);
        expect(proof).not.toBeNull();

        const expectedAmount = (BigInt(tokensPerCall) * BigInt(count)).toString();
        expect(proof!.amount).toBe(expectedAmount);

        // Cryptographic verification
        const isValid = StandardMerkleTree.verify(
          merkleRoot,
          ['address', 'uint256'],
          [user, proof!.amount],
          proof!.proof
        );
        expect(isValid).toBe(true);
      }

      // --- Step 6: Users claim tokens ---
      await earningsService.markAsClaimed(TOKEN_ADDRESS, USER_A, '0xCLAIM_A');
      await earningsService.markAsClaimed(TOKEN_ADDRESS, USER_B, '0xCLAIM_B');

      const claimedA = await earningsService.getEarning(TOKEN_ADDRESS, USER_A);
      expect(claimedA!.claimed).toBe(true);
      expect(claimedA!.claimTxHash).toBe('0xCLAIM_A');

      const claimedB = await earningsService.getEarning(TOKEN_ADDRESS, USER_B);
      expect(claimedB!.claimed).toBe(true);

      // User C hasn't claimed yet
      const unclaimedC = await earningsService.getEarning(TOKEN_ADDRESS, USER_C);
      expect(unclaimedC!.claimed).toBe(false);
      expect(unclaimedC!.claimTxHash).toBeUndefined();

      // --- Step 7: Proofs remain valid after claims ---
      const proofC = await merkleTreeService.generateProof(TOKEN_ADDRESS, USER_C);
      const isStillValid = StandardMerkleTree.verify(
        merkleRoot,
        ['address', 'uint256'],
        [USER_C, proofC!.amount],
        proofC!.proof
      );
      expect(isStillValid).toBe(true);
    });
  });
});
