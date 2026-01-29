/**
 * Tests for Firestore Merkle Tree Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

// Test data storage
let testData: Map<string, any> = new Map();
let shouldThrowError = false;

// Mock Firestore
vi.mock('../src/db/firestoreClient.js', () => {
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
    })),
  };

  return {
    getFirestoreClient: vi.fn(() => mockFirestore),
    Collections: {
      MERKLE_TREES: 'merkle-trees',
    },
  };
});

import { MerkleTreeService } from '../src/services/firestoreMerkleTreeService.js';

// Test helpers
const TEST_LEAVES: [string, string][] = [
  ['0x1111111111111111111111111111111111111111', '1000000000000000000000'],
  ['0x2222222222222222222222222222222222222222', '2000000000000000000000'],
  ['0x3333333333333333333333333333333333333333', '3000000000000000000000'],
];

function buildTestTreeEntry() {
  const tree = StandardMerkleTree.of(TEST_LEAVES, ['address', 'uint256']);
  return {
    merkleRoot: tree.root,
    totalLeaves: TEST_LEAVES.length,
    totalTokens: '6000000000000000000000',
    leaves: TEST_LEAVES.map(([addr, amt], i) => ({
      address: addr.toLowerCase(),
      amount: amt,
      index: i,
    })),
    treeDump: JSON.stringify(tree.dump()),
    generatedAt: new Date().toISOString(),
    chainId: '84532',
  };
}

describe('MerkleTreeService', () => {
  let service: MerkleTreeService;

  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;
    service = new MerkleTreeService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('storeMerkleTree', () => {
    it('should store tree entry with id set', async () => {
      const entry = buildTestTreeEntry();

      await service.storeMerkleTree('0xToken123', entry);

      const stored = testData.get('merkle-trees/0xtoken123');
      expect(stored).toBeDefined();
      expect(stored.id).toBe('0xtoken123');
      expect(stored.merkleRoot).toBe(entry.merkleRoot);
      expect(stored.totalLeaves).toBe(3);
      expect(stored.totalTokens).toBe('6000000000000000000000');
      expect(stored.leaves).toHaveLength(3);
      expect(stored.treeDump).toBeDefined();
    });

    it('should lowercase token address for doc ID', async () => {
      const entry = buildTestTreeEntry();

      await service.storeMerkleTree('0xABCDEF', entry);

      expect(testData.has('merkle-trees/0xabcdef')).toBe(true);
      expect(testData.get('merkle-trees/0xabcdef').id).toBe('0xabcdef');
    });

    it('should overwrite existing tree for same token', async () => {
      const entry1 = buildTestTreeEntry();
      await service.storeMerkleTree('0xToken', entry1);

      const entry2 = buildTestTreeEntry();
      entry2.totalTokens = '9999';
      await service.storeMerkleTree('0xToken', entry2);

      const stored = testData.get('merkle-trees/0xtoken');
      expect(stored.totalTokens).toBe('9999');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;
      const entry = buildTestTreeEntry();

      await expect(
        service.storeMerkleTree('0xToken', entry)
      ).rejects.toThrow('Firestore error');
    });
  });

  describe('getMerkleTree', () => {
    it('should return tree when it exists', async () => {
      const entry = buildTestTreeEntry();
      testData.set('merkle-trees/0xtoken', { id: '0xtoken', ...entry });

      const result = await service.getMerkleTree('0xToken');

      expect(result).not.toBeNull();
      expect(result?.merkleRoot).toBe(entry.merkleRoot);
      expect(result?.totalLeaves).toBe(3);
    });

    it('should return null when not found', async () => {
      const result = await service.getMerkleTree('0xNonExistent');

      expect(result).toBeNull();
    });

    it('should return null on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getMerkleTree('0xToken');

      expect(result).toBeNull();
    });

    it('should lowercase token address for lookup', async () => {
      const entry = buildTestTreeEntry();
      testData.set('merkle-trees/0xabc', { id: '0xabc', ...entry });

      const result = await service.getMerkleTree('0xABC');

      expect(result).not.toBeNull();
      expect(result?.merkleRoot).toBe(entry.merkleRoot);
    });
  });

  describe('generateProof', () => {
    it('should generate valid proof for known user', async () => {
      const entry = buildTestTreeEntry();
      testData.set('merkle-trees/0xtoken', { id: '0xtoken', ...entry });

      const userAddr = '0x1111111111111111111111111111111111111111';
      const result = await service.generateProof('0xToken', userAddr);

      expect(result).not.toBeNull();
      expect(Array.isArray(result!.proof)).toBe(true);
      expect(result!.proof.length).toBeGreaterThan(0);
      expect(result!.amount).toBe('1000000000000000000000');
      expect(result!.index).toBe(0);

      // Verify proof using StandardMerkleTree
      const tree = StandardMerkleTree.load(JSON.parse(entry.treeDump));
      const isValid = StandardMerkleTree.verify(
        tree.root,
        ['address', 'uint256'],
        [userAddr, '1000000000000000000000'],
        result!.proof
      );
      expect(isValid).toBe(true);
    });

    it('should return null when no tree exists for token', async () => {
      const result = await service.generateProof('0xNoTree', '0x1111111111111111111111111111111111111111');

      expect(result).toBeNull();
    });

    it('should return null when user is not in the tree', async () => {
      const entry = buildTestTreeEntry();
      testData.set('merkle-trees/0xtoken', { id: '0xtoken', ...entry });

      const result = await service.generateProof('0xToken', '0x9999999999999999999999999999999999999999');

      expect(result).toBeNull();
    });

    it('should handle case-insensitive user address matching', async () => {
      const entry = buildTestTreeEntry();
      testData.set('merkle-trees/0xtoken', { id: '0xtoken', ...entry });

      // Use uppercase version of address
      const result = await service.generateProof(
        '0xToken',
        '0x1111111111111111111111111111111111111111'.toUpperCase()
      );

      expect(result).not.toBeNull();
      expect(result!.amount).toBe('1000000000000000000000');
    });

    it('should return null if treeDump JSON is corrupted', async () => {
      const entry = buildTestTreeEntry();
      entry.treeDump = '{not valid json!!!';
      testData.set('merkle-trees/0xtoken', { id: '0xtoken', ...entry });

      const result = await service.generateProof('0xToken', '0x1111111111111111111111111111111111111111');

      expect(result).toBeNull();
    });

    it('should generate different proofs for different users in same tree', async () => {
      const entry = buildTestTreeEntry();
      testData.set('merkle-trees/0xtoken', { id: '0xtoken', ...entry });

      const proof1 = await service.generateProof(
        '0xToken',
        '0x1111111111111111111111111111111111111111'
      );
      const proof2 = await service.generateProof(
        '0xToken',
        '0x2222222222222222222222222222222222222222'
      );

      expect(proof1).not.toBeNull();
      expect(proof2).not.toBeNull();
      expect(proof1!.amount).toBe('1000000000000000000000');
      expect(proof2!.amount).toBe('2000000000000000000000');
      // Proofs should differ
      expect(JSON.stringify(proof1!.proof)).not.toBe(JSON.stringify(proof2!.proof));
    });
  });

  describe('setOnChainTxHash', () => {
    it('should update tx hash on existing entry', async () => {
      const entry = buildTestTreeEntry();
      testData.set('merkle-trees/0xtoken', { id: '0xtoken', ...entry });

      await service.setOnChainTxHash('0xToken', '0xDeadBeef');

      const stored = testData.get('merkle-trees/0xtoken');
      expect(stored.setOnChainTxHash).toBe('0xDeadBeef');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(
        service.setOnChainTxHash('0xToken', '0xTxHash')
      ).rejects.toThrow('Firestore error');
    });
  });
});
