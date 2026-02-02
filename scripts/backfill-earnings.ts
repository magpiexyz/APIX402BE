/**
 * Backfill Token Earnings from Request Queue
 *
 * One-time migration script to populate the `token-earnings` collection
 * from existing `request-queue` entries for tokens created before the
 * Merkle claim distribution migration.
 *
 * Usage:
 *   npx tsx scripts/backfill-earnings.ts [--dry-run] [--token <tokenAddress>]
 *
 * Options:
 *   --dry-run    Print what would be written without making changes
 *   --token      Only backfill for a specific token address
 */

import { Firestore } from '@google-cloud/firestore';

const DRY_RUN = process.argv.includes('--dry-run');
const TOKEN_FLAG_INDEX = process.argv.indexOf('--token');
const SPECIFIC_TOKEN = TOKEN_FLAG_INDEX !== -1 ? process.argv[TOKEN_FLAG_INDEX + 1] : null;

const COLLECTIONS = {
  IAO_TOKENS: 'iao-tokens',
  REQUEST_QUEUE: 'request-queue',
  TOKEN_EARNINGS: 'token-earnings',
};

interface RequestQueueEntry {
  id: string;
  iaoToken: string;
  from: string;
  fee: string;
  userRequestNumber?: string;
  globalRequestNumber?: string;
  createdAt: string;
}

interface IAOTokenEntry {
  id: string;
  slug: string;
  paymentTokenPrice?: string;
  paymentTokenDecimals?: number;
  distributionModel?: string;
  virtualTokensDistributed?: string;
}

interface EarningsAccumulator {
  tokenAddress: string;
  userAddress: string;
  totalTokensEarned: bigint;
  totalFeesPaid: bigint;
  callCount: bigint;
  lastEarnedAt: string;
}

async function main() {
  console.log('=== Backfill Token Earnings ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (SPECIFIC_TOKEN) {
    console.log(`Token filter: ${SPECIFIC_TOKEN}`);
  }
  console.log('');

  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) {
    console.error('GCP_PROJECT_ID environment variable is required');
    process.exit(1);
  }

  let credentials: any = undefined;
  if (process.env.GCP_CREDENTIALS) {
    credentials = JSON.parse(process.env.GCP_CREDENTIALS);
  }

  const firestore = new Firestore({
    projectId,
    ...(credentials && { credentials }),
  });

  // 1. Get all IAO tokens (or just the specific one)
  let tokensQuery = firestore.collection(COLLECTIONS.IAO_TOKENS);
  let tokenDocs;
  if (SPECIFIC_TOKEN) {
    const doc = await firestore.collection(COLLECTIONS.IAO_TOKENS).doc(SPECIFIC_TOKEN.toLowerCase()).get();
    tokenDocs = doc.exists ? [doc] : [];
  } else {
    const snapshot = await tokensQuery.get();
    tokenDocs = snapshot.docs;
  }

  console.log(`Found ${tokenDocs.length} token(s) to process`);

  let totalEntriesCreated = 0;
  let totalTokensProcessed = 0;

  for (const tokenDoc of tokenDocs) {
    const token = tokenDoc.data() as IAOTokenEntry;
    const tokenAddress = (token.id || tokenDoc.id).toLowerCase();
    console.log(`\nProcessing token: ${tokenAddress} (${token.slug})`);

    // 2. Get all request-queue entries for this token
    const queueSnapshot = await firestore
      .collection(COLLECTIONS.REQUEST_QUEUE)
      .where('iaoToken', '==', tokenAddress)
      .get();

    if (queueSnapshot.empty) {
      console.log(`  No request-queue entries found, skipping`);
      continue;
    }

    console.log(`  Found ${queueSnapshot.size} request-queue entries`);

    // 3. Determine token pricing
    const paymentTokenPrice = token.paymentTokenPrice || '1000';
    const paymentTokenDecimals = token.paymentTokenDecimals ?? 6;
    const priceMultiplier = BigInt(paymentTokenPrice);
    const decimalsDivisor = BigInt(10 ** paymentTokenDecimals);

    console.log(`  Price: ${paymentTokenPrice}, Decimals: ${paymentTokenDecimals}`);

    // 4. Accumulate earnings per user
    const earningsMap = new Map<string, EarningsAccumulator>();

    for (const queueDoc of queueSnapshot.docs) {
      const entry = queueDoc.data() as RequestQueueEntry;
      const userAddress = entry.from.toLowerCase();
      const fee = BigInt(entry.fee || '0');

      // Calculate tokens earned: (fee * price) / 10^decimals
      // For USDC (6 decimals) with price 1000: 1_000_000 * 1000 / 1_000_000 = 1000 tokens (in base units)
      // But we need 18-decimal token amounts, so: fee * 10^(18 - decimals)
      const tokensEarned = fee * BigInt(10 ** (18 - paymentTokenDecimals));

      const key = `${tokenAddress}#${userAddress}`;
      const existing = earningsMap.get(key);

      if (existing) {
        existing.totalTokensEarned += tokensEarned;
        existing.totalFeesPaid += fee;
        existing.callCount += BigInt(1);
        if (entry.createdAt > existing.lastEarnedAt) {
          existing.lastEarnedAt = entry.createdAt;
        }
      } else {
        earningsMap.set(key, {
          tokenAddress,
          userAddress,
          totalTokensEarned: tokensEarned,
          totalFeesPaid: fee,
          callCount: BigInt(1),
          lastEarnedAt: entry.createdAt || new Date().toISOString(),
        });
      }
    }

    console.log(`  Aggregated to ${earningsMap.size} unique user earnings`);

    // 5. Write earnings to Firestore
    let virtualTotal = BigInt(0);

    for (const [docId, acc] of earningsMap) {
      virtualTotal += acc.totalTokensEarned;

      const earningDoc = {
        id: docId,
        tokenAddress: acc.tokenAddress,
        userAddress: acc.userAddress,
        totalTokensEarned: acc.totalTokensEarned.toString(),
        totalFeesPaid: acc.totalFeesPaid.toString(),
        callCount: acc.callCount.toString(),
        lastEarnedAt: acc.lastEarnedAt,
        claimed: false,
        createdAt: acc.lastEarnedAt,
        updatedAt: new Date().toISOString(),
      };

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would write: ${docId}`);
        console.log(`    tokens=${acc.totalTokensEarned.toString()}, fees=${acc.totalFeesPaid.toString()}, calls=${acc.callCount.toString()}`);
      } else {
        await firestore.collection(COLLECTIONS.TOKEN_EARNINGS).doc(docId).set(earningDoc, { merge: true });
        console.log(`  Wrote earnings: ${docId}`);
      }

      totalEntriesCreated++;
    }

    // 6. Update token doc with virtual distribution total and model
    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would update token: virtualTokensDistributed=${virtualTotal.toString()}, distributionModel=merkle`);
    } else {
      await firestore.collection(COLLECTIONS.IAO_TOKENS).doc(tokenAddress).update({
        virtualTokensDistributed: virtualTotal.toString(),
        distributionModel: 'merkle',
        updatedAt: new Date().toISOString(),
      });
      console.log(`  Updated token: virtualTokensDistributed=${virtualTotal.toString()}`);
    }

    totalTokensProcessed++;
  }

  console.log('\n=== Summary ===');
  console.log(`Tokens processed: ${totalTokensProcessed}`);
  console.log(`Earnings entries ${DRY_RUN ? 'would create' : 'created'}: ${totalEntriesCreated}`);
  console.log('Done!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
