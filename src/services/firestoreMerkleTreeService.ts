/**
 * Firestore Merkle Tree Service
 *
 * Stores and retrieves Merkle trees for token claim distribution.
 * Trees are generated at graduation and used to serve proofs for individual claims.
 */

import { getFirestoreClient, Collections } from '../db/firestoreClient.js';
import type { Firestore } from '@google-cloud/firestore';

/**
 * Leaf entry in the Merkle tree
 */
export interface MerkleLeaf {
  address: string;   // User wallet address
  amount: string;    // BigInt — token amount claimable
  index: number;     // Leaf index in tree
}

/**
 * Merkle tree entry — one per graduated token
 * Document ID: `${tokenAddress}`
 */
export interface MerkleTreeEntry {
  id: string;                     // Token address (Document ID)
  merkleRoot: string;             // bytes32 hex string
  totalLeaves: number;            // Number of claimants
  totalTokens: string;            // BigInt — sum of all leaf amounts
  leaves: MerkleLeaf[];           // All leaves for proof regeneration
  treeDump: string;               // JSON.stringify(tree.dump()) for OZ StandardMerkleTree
  generatedAt: string;            // ISO timestamp
  chainId: string;                // Chain where root is set
  setOnChainTxHash?: string;      // Tx hash of on-chain merkle root set
}

/**
 * Proof response returned to frontend for claiming
 */
export interface MerkleProofResponse {
  amount: string;                  // Token amount to claim
  proof: string[];                 // Merkle proof (array of bytes32 hex)
  merkleRoot: string;              // bytes32 hex
  index: number;                   // Leaf index
  claimed: boolean;                // Whether already claimed
}

export class MerkleTreeService {
  private firestore: Firestore;
  private collectionName: string;

  constructor() {
    this.firestore = getFirestoreClient();
    this.collectionName = Collections.MERKLE_TREES;
  }

  /**
   * Store a Merkle tree after generation at graduation
   */
  async storeMerkleTree(tokenAddress: string, entry: Omit<MerkleTreeEntry, 'id'>): Promise<void> {
    const docId = tokenAddress.toLowerCase();
    try {
      await this.firestore.collection(this.collectionName).doc(docId).set({
        id: docId,
        ...entry,
      });
      console.log(`✅ Stored Merkle tree for ${tokenAddress} (${entry.totalLeaves} leaves, root: ${entry.merkleRoot})`);
    } catch (err) {
      console.error(`❌ Failed to store Merkle tree for ${tokenAddress}:`, err);
      throw err;
    }
  }

  /**
   * Get the Merkle tree for a token
   */
  async getMerkleTree(tokenAddress: string): Promise<MerkleTreeEntry | null> {
    const docId = tokenAddress.toLowerCase();
    try {
      const doc = await this.firestore.collection(this.collectionName).doc(docId).get();
      if (!doc.exists) {
        return null;
      }
      return doc.data() as MerkleTreeEntry;
    } catch (err) {
      console.error(`❌ Failed to get Merkle tree for ${tokenAddress}:`, err);
      return null;
    }
  }

  /**
   * Generate a Merkle proof for a specific user from the stored tree dump.
   * Uses OpenZeppelin StandardMerkleTree to regenerate the proof.
   */
  async generateProof(
    tokenAddress: string,
    userAddress: string
  ): Promise<{ proof: string[]; amount: string; index: number } | null> {
    const tree = await this.getMerkleTree(tokenAddress);
    if (!tree) {
      return null;
    }

    // Find the leaf for this user
    const normalizedUser = userAddress.toLowerCase();
    const leaf = tree.leaves.find(l => l.address.toLowerCase() === normalizedUser);
    if (!leaf) {
      return null;
    }

    // Regenerate proof from tree dump using OZ StandardMerkleTree
    try {
      const { StandardMerkleTree } = await import('@openzeppelin/merkle-tree');
      const loadedTree = StandardMerkleTree.load(JSON.parse(tree.treeDump));

      for (const [i, value] of loadedTree.entries()) {
        if ((value[0] as string).toLowerCase() === normalizedUser) {
          const proof = loadedTree.getProof(i);
          return {
            proof,
            amount: leaf.amount,
            index: leaf.index,
          };
        }
      }

      return null;
    } catch (err) {
      console.error(`❌ Failed to generate proof for ${userAddress} on ${tokenAddress}:`, err);
      return null;
    }
  }

  /**
   * Update the on-chain tx hash after successfully setting the Merkle root
   */
  async setOnChainTxHash(tokenAddress: string, txHash: string): Promise<void> {
    const docId = tokenAddress.toLowerCase();
    try {
      await this.firestore.collection(this.collectionName).doc(docId).update({
        setOnChainTxHash: txHash,
      });
    } catch (err) {
      console.error(`❌ Failed to update tx hash for Merkle tree ${tokenAddress}:`, err);
      throw err;
    }
  }
}
