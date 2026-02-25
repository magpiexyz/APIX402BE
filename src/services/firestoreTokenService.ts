/**
 * Firestore Token Service (replaces DynamoDB Service)
 *
 * Handles IAO Token CRUD operations using Cloud Firestore.
 * Maintains the same interface as the original DynamoDB service.
 */

import { getFirestoreClient, Collections } from '../db/firestoreClient.js';
import type { Firestore } from '@google-cloud/firestore';
import { normalizeAddress } from '../utils/normalizeAddress.js';

/**
 * Parameter definition for structured API documentation
 */
export interface ApiParameter {
  name: string;           // Parameter name (e.g., "userId")
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;    // What this param does
  example?: string;       // Example value
}

/**
 * Individual API entry within a token
 * Multiple APIs can be registered under a single token
 */
export interface ApiEntry {
  index: number;        // 0-based index (order of registration)
  slug: string;         // Unique slug within the token (e.g., "eigenpie-pool")
  name: string;         // API name/title
  apiUrl: string;       // Builder's API endpoint URL (hidden from public)
  description: string;  // Required description
  fee: string;          // Fee in payment token smallest unit (e.g., "10000" = $0.01 USDC with 6 decimals)
  method?: 'GET' | 'POST';  // HTTP method (defaults to GET)
  parameters?: ApiParameter[];     // Request params (query for GET, body for POST)
  responseFormat?: string;         // Expected response format (JSON example)
  createdAt: string;    // ISO timestamp when this API was added
}

/**
 * IAO Token database entry (represents a server/builder)
 * One token can have multiple APIs (1:N relationship)
 * Each API has its own fee (per-API pricing)
 */
export interface IAOTokenDBEntry {
  id: string;                    // Token address (lowercase) - Document ID
  slug: string;                  // Unique server slug (e.g., "magpie")
  name: string;                  // Token/server name
  symbol: string;                // Token symbol
  builder: string;               // Builder address (lowercase for EVM, original case for Solana)
  paymentToken: string;          // Payment token address
  chainId: string;               // Chain ID: "84532" (Base Sepolia), "devnet" (Solana), etc.
  subscriptionCount: string;     // BigInt as string, default "0" - aggregated across all APIs
  refundCount: string;           // BigInt as string, default "0"
  fulfilledCount: string;        // BigInt as string, default "0"
  totalFeesCollected?: string;   // BigInt as string - for Solana bonding progress tracking
  tags?: string[];               // Array of category tags (e.g., ["crypto", "trading"])
  logoUrl?: string;              // Cloudinary URL for server logo
  apis: ApiEntry[];              // Array of registered APIs (each with own fee)
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  // Merkle claim distribution fields
  virtualTokensDistributed?: string;  // BigInt — total virtual tokens allocated (DB-tracked)
  merkleRoot?: string;                // bytes32 hex, set at graduation
  distributionModel?: string;         // "batch" | "merkle" — controls graduation path
  paymentTokenPrice?: string;         // Cached from factory (for tokensPerCall calc)
  paymentTokenDecimals?: number;      // Cached (6 for USDC)
  graduated?: boolean;                // Whether token has graduated
  // Fee distribution tracking
  pendingFeesForDistribution?: string;  // BigInt — fees collected but not yet distributed on-chain
  lastFeeDistributionAt?: string;       // ISO timestamp of last on-chain fee distribution
  lastFeeDistributionTxHash?: string;   // TX hash of last on-chain fee distribution
}

class TokenService {
  private firestore: Firestore;
  private collectionName: string;

  constructor() {
    this.firestore = getFirestoreClient();
    this.collectionName = Collections.IAO_TOKENS;
  }

  async putItem(item: IAOTokenDBEntry): Promise<void> {
    try {
      const docRef = this.firestore.collection(this.collectionName).doc(item.id);
      await docRef.set(item);
      console.log(`✅ Firestore putItem success for ${item.id}`);
    } catch (err) {
      console.error(`❌ Firestore putItem fail for ${item.id}:`, err);
      throw err;
    }
  }

  async getItem(id: string): Promise<IAOTokenDBEntry | null> {
    const normalizedId = normalizeAddress(id);
    try {
      const docRef = this.firestore.collection(this.collectionName).doc(normalizedId);
      const doc = await docRef.get();
      if (!doc.exists) {
        return null;
      }
      return doc.data() as IAOTokenDBEntry;
    } catch (err) {
      console.error(`❌ Firestore getItem fail for ${id}:`, err);
      return null;
    }
  }

  async deleteItem(id: string): Promise<void> {
    const normalizedId = normalizeAddress(id);
    try {
      const docRef = this.firestore.collection(this.collectionName).doc(normalizedId);
      await docRef.delete();
      console.log(`✅ Firestore deleteItem success for ${id}`);
    } catch (err) {
      console.error(`❌ Firestore deleteItem fail for ${id}:`, err);
      throw err;
    }
  }

  async scanAllItems(): Promise<IAOTokenDBEntry[]> {
    try {
      const snapshot = await this.firestore.collection(this.collectionName).get();
      return snapshot.docs.map(doc => doc.data() as IAOTokenDBEntry);
    } catch (err) {
      console.error("❌ Firestore scanAllItems error:", err);
      throw err;
    }
  }

  // Alias for scanAllItems - used by agent filtering
  async listAll(): Promise<IAOTokenDBEntry[]> {
    return this.scanAllItems();
  }

  async scanItemsByBuilder(builderAddress: string): Promise<IAOTokenDBEntry[]> {
    const normalizedBuilder = normalizeAddress(builderAddress);
    try {
      const snapshot = await this.firestore
        .collection(this.collectionName)
        .where('builder', '==', normalizedBuilder)
        .get();
      return snapshot.docs.map(doc => doc.data() as IAOTokenDBEntry);
    } catch (err) {
      console.error(`❌ Firestore scanItemsByBuilder error for ${builderAddress}:`, err);
      throw err;
    }
  }

  /**
   * Get a token by its slug using Firestore index for O(1) lookup
   */
  async getItemBySlug(slug: string): Promise<IAOTokenDBEntry | null> {
    const normalizedSlug = slug.toLowerCase();
    try {
      const snapshot = await this.firestore
        .collection(this.collectionName)
        .where('slug', '==', normalizedSlug)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return null;
      }
      return snapshot.docs[0].data() as IAOTokenDBEntry;
    } catch (err) {
      console.error(`❌ Firestore getItemBySlug fail for ${slug}:`, err);
      return null;
    }
  }

  /**
   * Check if a server slug already exists
   */
  async slugExists(slug: string): Promise<boolean> {
    const token = await this.getItemBySlug(slug);
    return token !== null;
  }

  /**
   * Check if an API URL + method combination already exists globally across all servers
   * Same URL with different methods (GET vs POST) is allowed
   * Returns the server slug and token address if found
   */
  async apiUrlExists(apiUrl: string, method: 'GET' | 'POST' = 'GET'): Promise<{ exists: boolean; serverSlug?: string; tokenAddress?: string }> {
    try {
      const tokens = await this.scanAllItems();
      for (const token of tokens) {
        if (token.apis) {
          // Check for same URL AND same method
          const matchingApi = token.apis.find(api =>
            api.apiUrl === apiUrl && (api.method || 'GET') === method
          );
          if (matchingApi) {
            return {
              exists: true,
              serverSlug: token.slug,
              tokenAddress: token.id
            };
          }
        }
      }
      return { exists: false };
    } catch (err) {
      console.error(`❌ Firestore apiUrlExists error:`, err);
      return { exists: false };
    }
  }

  /**
   * Check if multiple API URL + method combinations exist globally
   * Same URL with different methods (GET vs POST) is allowed
   * Returns array of duplicates found
   */
  async checkApiUrlsDuplicate(apis: { url: string; method: 'GET' | 'POST' }[]): Promise<{ url: string; method: string; serverSlug: string; tokenAddress: string }[]> {
    try {
      const tokens = await this.scanAllItems();
      const duplicates: { url: string; method: string; serverSlug: string; tokenAddress: string }[] = [];

      for (const token of tokens) {
        if (token.apis) {
          for (const existingApi of token.apis) {
            // Check if any of the new APIs match both URL and method
            const matchingNew = apis.find(newApi =>
              newApi.url === existingApi.apiUrl &&
              newApi.method === (existingApi.method || 'GET')
            );
            if (matchingNew) {
              duplicates.push({
                url: existingApi.apiUrl,
                method: existingApi.method || 'GET',
                serverSlug: token.slug,
                tokenAddress: token.id
              });
            }
          }
        }
      }

      return duplicates;
    } catch (err) {
      console.error(`❌ Firestore checkApiUrlsDuplicate error:`, err);
      return [];
    }
  }

  /**
   * Add a new API to an existing token
   * The new API will be assigned the next available index
   */
  async addApiToToken(
    tokenAddress: string,
    apiSlug: string,
    apiName: string,
    apiUrl: string,
    description: string,
    fee: string,
    method: 'GET' | 'POST' = 'GET',
    parameters: ApiParameter[] = [],
    responseFormat: string = ''
  ): Promise<ApiEntry | null> {
    const token = await this.getItem(tokenAddress);
    if (!token) {
      console.error(`❌ Token ${tokenAddress} not found`);
      return null;
    }

    // Ensure apis array exists
    const apis = token.apis || [];

    // Check if API slug already exists within this token
    if (apis.some(api => api.slug === apiSlug.toLowerCase())) {
      console.error(`❌ API slug ${apiSlug} already exists in token ${tokenAddress}`);
      return null;
    }

    // Calculate next index
    const nextIndex = apis.length;

    // Create new API entry
    const newApi: ApiEntry = {
      index: nextIndex,
      slug: apiSlug.toLowerCase(),
      name: apiName,
      apiUrl: apiUrl,
      description: description,
      fee: fee,
      method: method,
      parameters: parameters,
      responseFormat: responseFormat,
      createdAt: new Date().toISOString(),
    };

    // Add to apis array
    apis.push(newApi);

    // Update token
    const updatedToken: IAOTokenDBEntry = {
      ...token,
      apis: apis,
      updatedAt: new Date().toISOString(),
    };

    await this.putItem(updatedToken);
    console.log(`✅ Added API ${apiName} (slug: ${apiSlug}, index: ${nextIndex}) to token ${tokenAddress}`);

    return newApi;
  }

  /**
   * Get a specific API from a token by slug
   */
  getApiBySlug(token: IAOTokenDBEntry, apiSlug: string): ApiEntry | null {
    if (!token.apis || token.apis.length === 0) {
      return null;
    }
    return token.apis.find(api => api.slug === apiSlug.toLowerCase()) || null;
  }

  /**
   * Get a specific API from a token by index
   */
  getApiByIndex(token: IAOTokenDBEntry, index: number): ApiEntry | null {
    if (!token.apis || token.apis.length === 0) {
      return null;
    }
    return token.apis.find(api => api.index === index) || null;
  }

  /**
   * Atomically increment virtualTokensDistributed on a token document using a Firestore transaction.
   * Caps the increment so virtualTokensDistributed never exceeds the graduation threshold.
   * Returns the new total, actual tokens credited (may be less than requested), and token metadata.
   */
  async incrementVirtualDistributed(
    tokenAddress: string,
    tokensEarned: string
  ): Promise<{ newTotal: string; actualTokensCredited: string; chainId: string; graduated: boolean; totalFeesCollected: string }> {
    const normalizedId = normalizeAddress(tokenAddress);
    try {
      const docRef = this.firestore.collection(this.collectionName).doc(normalizedId);

      const result = await this.firestore.runTransaction(async (txn) => {
        const doc = await txn.get(docRef);
        if (!doc.exists) {
          throw new Error(`Token ${tokenAddress} not found for virtual distribution increment`);
        }
        const current = doc.data() as IAOTokenDBEntry;
        const chainId = current.chainId;
        const graduated = current.graduated ?? false;

        // If already graduated, no more tokens can be distributed
        if (graduated) {
          return {
            newTotal: current.virtualTokensDistributed || "0",
            actualTokensCredited: "0",
            chainId,
            graduated: true,
            totalFeesCollected: current.totalFeesCollected || "0",
          };
        }

        // Determine graduation threshold based on chain
        const solanaChains = ['devnet', 'mainnet-beta', 'testnet'];
        const isSolana = solanaChains.includes(chainId);

        // Check for test graduation threshold override (for testing with small amounts)
        const testThreshold = process.env.TEST_GRADUATION_THRESHOLD;
        const defaultThreshold = isSolana
          ? BigInt("625000000000000000")        // 625M with 9 decimals
          : BigInt("625000000000000000000000000"); // 625M with 18 decimals

        const threshold = testThreshold ? BigInt(testThreshold) : defaultThreshold;

        const currentVirtual = BigInt(current.virtualTokensDistributed || "0");
        const requested = BigInt(tokensEarned);

        // Cap tokens to remaining capacity before graduation threshold
        const remainingCapacity = threshold - currentVirtual;
        if (remainingCapacity <= 0n) {
          // Already at or past threshold — no more tokens to distribute
          return {
            newTotal: currentVirtual.toString(),
            actualTokensCredited: "0",
            chainId,
            graduated,
            totalFeesCollected: current.totalFeesCollected || "0",
          };
        }

        const actualTokens = requested < remainingCapacity ? requested : remainingCapacity;
        const newVirtual = (currentVirtual + actualTokens).toString();

        txn.update(docRef, {
          virtualTokensDistributed: newVirtual,
          updatedAt: new Date().toISOString(),
        });

        return {
          newTotal: newVirtual,
          actualTokensCredited: actualTokens.toString(),
          chainId,
          graduated,
          totalFeesCollected: current.totalFeesCollected || "0",
        };
      });

      console.log(`✅ Virtual tokens distributed updated: ${result.newTotal} (credited: ${result.actualTokensCredited})`);
      return result;
    } catch (err) {
      console.error(`❌ Failed to increment virtual distributed for ${tokenAddress}:`, err);
      throw err;
    }
  }
  /**
   * Atomically increment virtualTokensDistributed AND user earnings in a single Firestore transaction.
   * Prevents the race condition where graduation reads earnings before a concurrent request finishes writing them.
   * Caps tokens at the graduation threshold — no overflow possible.
   */
  async incrementVirtualDistributedWithEarnings(
    tokenAddress: string,
    userAddress: string,
    tokensEarned: string,
    feePaid: string
  ): Promise<{ newTotal: string; actualTokensCredited: string; chainId: string; graduated: boolean; totalFeesCollected: string }> {
    const normalizedToken = normalizeAddress(tokenAddress);
    const normalizedUser = normalizeAddress(userAddress);
    const earningsDocId = `${normalizedToken}#${normalizedUser}`;

    try {
      const tokenDocRef = this.firestore.collection(this.collectionName).doc(normalizedToken);
      const earningsDocRef = this.firestore.collection(Collections.TOKEN_EARNINGS).doc(earningsDocId);

      const result = await this.firestore.runTransaction(async (txn) => {
        // Read both documents in the same transaction
        const [tokenDoc, earningsDoc] = await Promise.all([
          txn.get(tokenDocRef),
          txn.get(earningsDocRef),
        ]);

        if (!tokenDoc.exists) {
          throw new Error(`Token ${tokenAddress} not found for virtual distribution increment`);
        }
        const current = tokenDoc.data() as IAOTokenDBEntry;
        const chainId = current.chainId;
        const graduated = current.graduated ?? false;

        // If already graduated, no more tokens can be distributed
        if (graduated) {
          return {
            newTotal: current.virtualTokensDistributed || "0",
            actualTokensCredited: "0",
            chainId,
            graduated: true,
            totalFeesCollected: current.totalFeesCollected || "0",
          };
        }

        // Determine graduation threshold based on chain
        const solanaChains = ['devnet', 'mainnet-beta', 'testnet'];
        const isSolana = solanaChains.includes(chainId);

        // Check for test graduation threshold override (for testing with small amounts)
        const testThreshold = process.env.TEST_GRADUATION_THRESHOLD;
        const defaultThreshold = isSolana
          ? BigInt("625000000000000000")        // 625M with 9 decimals
          : BigInt("625000000000000000000000000"); // 625M with 18 decimals

        const threshold = testThreshold ? BigInt(testThreshold) : defaultThreshold;

        const currentVirtual = BigInt(current.virtualTokensDistributed || "0");
        const requested = BigInt(tokensEarned);

        // Cap tokens to remaining capacity before graduation threshold
        const remainingCapacity = threshold - currentVirtual;
        if (remainingCapacity <= 0n) {
          return {
            newTotal: currentVirtual.toString(),
            actualTokensCredited: "0",
            chainId,
            graduated,
            totalFeesCollected: current.totalFeesCollected || "0",
          };
        }

        const actualTokens = requested < remainingCapacity ? requested : remainingCapacity;
        const newVirtual = (currentVirtual + actualTokens).toString();
        const currentFees = BigInt(current.totalFeesCollected || "0");
        const newTotalFees = (currentFees + BigInt(feePaid)).toString();
        // Track pending fees that need to be distributed on-chain (for weekly distribution)
        const currentPendingFees = BigInt((current as any).pendingFeesForDistribution || "0");
        const newPendingFees = (currentPendingFees + BigInt(feePaid)).toString();
        const now = new Date().toISOString();

        // Write 1: Update virtual distribution, total fees, and pending fees on token doc
        txn.update(tokenDocRef, {
          virtualTokensDistributed: newVirtual,
          totalFeesCollected: newTotalFees,
          pendingFeesForDistribution: newPendingFees,
          updatedAt: now,
        });

        // Write 2: Create or update earnings doc in the SAME transaction
        if (!earningsDoc.exists) {
          txn.set(earningsDocRef, {
            id: earningsDocId,
            tokenAddress: normalizedToken,
            userAddress: normalizedUser,
            totalTokensEarned: actualTokens.toString(),
            totalFeesPaid: feePaid,
            callCount: "1",
            lastEarnedAt: now,
            claimed: false,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          const existing = earningsDoc.data()!;
          const newTotalTokens = (BigInt(existing.totalTokensEarned) + actualTokens).toString();
          const newTotalFees = (BigInt(existing.totalFeesPaid) + BigInt(feePaid)).toString();
          const newCallCount = (BigInt(existing.callCount) + 1n).toString();
          txn.update(earningsDocRef, {
            totalTokensEarned: newTotalTokens,
            totalFeesPaid: newTotalFees,
            callCount: newCallCount,
            lastEarnedAt: now,
            updatedAt: now,
          });
        }

        return {
          newTotal: newVirtual,
          actualTokensCredited: actualTokens.toString(),
          chainId,
          graduated,
          totalFeesCollected: newTotalFees,
        };
      });

      console.log(`✅ Virtual + earnings updated atomically: ${result.newTotal} (credited: ${result.actualTokensCredited} to ${normalizedUser}, fees: ${result.totalFeesCollected})`);
      return result;
    } catch (err) {
      console.error(`❌ Failed atomic increment for ${tokenAddress}/${userAddress}:`, err);
      throw err;
    }
  }
}

export { TokenService };
