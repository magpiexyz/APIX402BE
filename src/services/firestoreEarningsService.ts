/**
 * Firestore Earnings Service
 *
 * Tracks virtual token earnings per user per token.
 * Earnings are accumulated from API calls and claimed via Merkle proof after graduation.
 */

import { getFirestoreClient, Collections, FieldValue } from '../db/firestoreClient.js';
import type { Firestore } from '@google-cloud/firestore';

/**
 * Token earning entry — tracks cumulative earnings for a user on a specific token
 * Document ID: `${tokenAddress}#${userAddress}`
 */
export interface TokenEarningEntry {
  id: string;                    // Document ID
  tokenAddress: string;          // IAO token address (lowercase for EVM)
  userAddress: string;           // User wallet address
  totalTokensEarned: string;    // BigInt — cumulative tokens from API calls
  totalFeesPaid: string;        // BigInt — cumulative USDC fees
  callCount: string;            // BigInt — number of API calls
  lastEarnedAt: string;         // ISO timestamp of last earning
  claimed: boolean;             // Whether tokens have been claimed post-graduation
  claimTxHash?: string;         // Transaction hash of claim (if claimed)
  createdAt: string;            // ISO timestamp
  updatedAt: string;            // ISO timestamp
}

export class EarningsService {
  private firestore: Firestore;
  private collectionName: string;

  constructor() {
    this.firestore = getFirestoreClient();
    this.collectionName = Collections.TOKEN_EARNINGS;
  }

  /**
   * Build document ID from token and user addresses
   */
  private buildDocId(tokenAddress: string, userAddress: string): string {
    return `${tokenAddress.toLowerCase()}#${userAddress.toLowerCase()}`;
  }

  /**
   * Increment earnings for a user after a successful API call.
   * Creates the document if it doesn't exist, otherwise atomically increments.
   */
  async incrementEarnings(
    tokenAddress: string,
    userAddress: string,
    tokensEarned: string,
    feePaid: string
  ): Promise<void> {
    const docId = this.buildDocId(tokenAddress, userAddress);
    const docRef = this.firestore.collection(this.collectionName).doc(docId);
    const now = new Date().toISOString();

    try {
      const doc = await docRef.get();

      if (!doc.exists) {
        // Create new entry
        const entry: TokenEarningEntry = {
          id: docId,
          tokenAddress: tokenAddress.toLowerCase(),
          userAddress: userAddress.toLowerCase(),
          totalTokensEarned: tokensEarned,
          totalFeesPaid: feePaid,
          callCount: "1",
          lastEarnedAt: now,
          claimed: false,
          createdAt: now,
          updatedAt: now,
        };
        await docRef.set(entry);
      } else {
        // Atomically increment existing entry
        const existing = doc.data() as TokenEarningEntry;
        const newTotalTokens = (BigInt(existing.totalTokensEarned) + BigInt(tokensEarned)).toString();
        const newTotalFees = (BigInt(existing.totalFeesPaid) + BigInt(feePaid)).toString();
        const newCallCount = (BigInt(existing.callCount) + BigInt(1)).toString();

        await docRef.update({
          totalTokensEarned: newTotalTokens,
          totalFeesPaid: newTotalFees,
          callCount: newCallCount,
          lastEarnedAt: now,
          updatedAt: now,
        });
      }

      console.log(`✅ Earnings incremented for ${userAddress} on ${tokenAddress}: +${tokensEarned} tokens`);
    } catch (err) {
      console.error(`❌ Failed to increment earnings for ${userAddress} on ${tokenAddress}:`, err);
      throw err;
    }
  }

  /**
   * Get all earnings for a specific token (for Merkle tree generation)
   */
  async getEarningsByToken(tokenAddress: string): Promise<TokenEarningEntry[]> {
    try {
      const snapshot = await this.firestore
        .collection(this.collectionName)
        .where('tokenAddress', '==', tokenAddress.toLowerCase())
        .get();

      return snapshot.docs.map(doc => doc.data() as TokenEarningEntry);
    } catch (err) {
      console.error(`❌ Failed to get earnings for token ${tokenAddress}:`, err);
      throw err;
    }
  }

  /**
   * Get all earnings for a specific user (across all tokens)
   */
  async getEarningsByUser(userAddress: string): Promise<TokenEarningEntry[]> {
    try {
      const snapshot = await this.firestore
        .collection(this.collectionName)
        .where('userAddress', '==', userAddress.toLowerCase())
        .get();

      return snapshot.docs.map(doc => doc.data() as TokenEarningEntry);
    } catch (err) {
      console.error(`❌ Failed to get earnings for user ${userAddress}:`, err);
      throw err;
    }
  }

  /**
   * Get a single earning entry for a user on a specific token
   */
  async getEarning(tokenAddress: string, userAddress: string): Promise<TokenEarningEntry | null> {
    const docId = this.buildDocId(tokenAddress, userAddress);
    try {
      const doc = await this.firestore.collection(this.collectionName).doc(docId).get();
      if (!doc.exists) {
        return null;
      }
      return doc.data() as TokenEarningEntry;
    } catch (err) {
      console.error(`❌ Failed to get earning for ${userAddress} on ${tokenAddress}:`, err);
      return null;
    }
  }

  /**
   * Mark an earning as claimed after successful on-chain claim
   */
  async markAsClaimed(tokenAddress: string, userAddress: string, txHash: string): Promise<void> {
    const docId = this.buildDocId(tokenAddress, userAddress);
    try {
      await this.firestore.collection(this.collectionName).doc(docId).update({
        claimed: true,
        claimTxHash: txHash,
        updatedAt: new Date().toISOString(),
      });
      console.log(`✅ Marked earning as claimed for ${userAddress} on ${tokenAddress}`);
    } catch (err) {
      console.error(`❌ Failed to mark earning as claimed:`, err);
      throw err;
    }
  }
}
