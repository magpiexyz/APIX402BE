#!/usr/bin/env npx tsx
/**
 * Local E2E Graduation Test Script
 *
 * Tests the full graduation flow without Cloud Tasks or Lambda:
 *   1. Seeds a test token near graduation threshold
 *   2. Seeds earnings for 3 test wallets
 *   3. Calls incrementVirtualDistributed to cross the threshold
 *   4. Manually calls POST /internal/graduate/:tokenAddress
 *   5. Verifies Merkle tree was built correctly
 *   6. Calls POST /internal/graduation-confirm/:tokenAddress
 *   7. Verifies graduated=true on token doc
 *   8. Cleans up test data
 *
 * Prerequisites:
 *   - `yarn dev` running on localhost:3000 (or set BASE_URL)
 *   - Firestore credentials configured (GCP_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS, etc.)
 *   - Set GRADUATION_INTERNAL_SECRET in .env (or the script uses "test-secret")
 *
 * Usage:
 *   npx tsx scripts/test-graduation-local.ts
 *   BASE_URL=http://localhost:4000 npx tsx scripts/test-graduation-local.ts
 */

import { config } from 'dotenv';
config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SECRET = process.env.GRADUATION_INTERNAL_SECRET || 'test-secret';

// Test constants
// Valid EVM address = 0x + 40 hex chars (20 bytes). Use timestamp for uniqueness.
const ts = Date.now().toString(16).padStart(10, '0').slice(0, 10);
const TEST_TOKEN = `0xee0000000000000000000000000000${ts}`;
const TEST_SLUG = 'grad-test-' + Date.now().toString(36);
const TEST_CHAIN = '84532'; // Base Sepolia

// EVM graduation threshold: 625M tokens with 18 decimals
const GRADUATION_THRESHOLD = BigInt('625000000000000000000000000');
// Seed just below threshold
const NEAR_THRESHOLD = GRADUATION_THRESHOLD - BigInt('1000000000000000000000'); // 1000 tokens below
const PUSH_OVER_AMOUNT = BigInt('2000000000000000000000'); // 2000 tokens — enough to cross

// Valid 20-byte EVM addresses (0x + exactly 40 hex chars)
const TEST_USERS = [
  { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa001', tokens: '200000000000000000000000000' },
  { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb002', tokens: '150000000000000000000000000' },
  { address: '0xccccccccccccccccccccccccccccccccccccc003', tokens: '275000000000000000000000000' },
];

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

async function post(path: string, body?: any): Promise<{ status: number; data: any }> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Graduation-Secret': SECRET,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await resp.json().catch(() => null);
  return { status: resp.status, data };
}

async function get(path: string): Promise<{ status: number; data: any }> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    headers: { 'X-Graduation-Secret': SECRET },
  });
  const data = await resp.json().catch(() => null);
  return { status: resp.status, data };
}

// ─────────────────────────────────────────────────────
// Firestore direct access (for seeding and verification)
// ─────────────────────────────────────────────────────

import { Firestore } from '@google-cloud/firestore';

function createFirestore(): Firestore {
  const projectId = process.env.GCP_PROJECT_ID;
  let credentials: any;
  if (process.env.GCP_CREDENTIALS) {
    credentials = JSON.parse(process.env.GCP_CREDENTIALS);
  }
  return new Firestore({ projectId, ...(credentials && { credentials }) });
}

const db = createFirestore();

async function seedTestToken(): Promise<void> {
  const docId = TEST_TOKEN.toLowerCase();
  await db.collection('iao-tokens').doc(docId).set({
    id: docId,
    slug: TEST_SLUG,
    name: 'Graduation Test Token',
    symbol: 'GTEST',
    builder: '0xbuilder_test',
    paymentToken: '0xusdc_test',
    chainId: TEST_CHAIN,
    subscriptionCount: '100',
    refundCount: '0',
    fulfilledCount: '100',
    totalFeesCollected: '100000000',
    apis: [{ slug: 'test-api', endpoint: 'https://httpbin.org/get', fee: '1000000' }],
    virtualTokensDistributed: NEAR_THRESHOLD.toString(),
    distributionModel: 'merkle',
    paymentTokenPrice: '25000000000000000000000',
    paymentTokenDecimals: 6,
    graduated: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function seedTestEarnings(): Promise<void> {
  for (const user of TEST_USERS) {
    const docId = `${TEST_TOKEN.toLowerCase()}#${user.address.toLowerCase()}`;
    await db.collection('token-earnings').doc(docId).set({
      id: docId,
      tokenAddress: TEST_TOKEN.toLowerCase(),
      userAddress: user.address.toLowerCase(),
      totalTokensEarned: user.tokens,
      totalFeesPaid: '50000000',
      callCount: '50',
      lastEarnedAt: new Date().toISOString(),
      claimed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

async function getTokenDoc(): Promise<any> {
  const doc = await db.collection('iao-tokens').doc(TEST_TOKEN.toLowerCase()).get();
  return doc.exists ? doc.data() : null;
}

async function getMerkleDoc(): Promise<any> {
  const doc = await db.collection('merkle-trees').doc(TEST_TOKEN.toLowerCase()).get();
  return doc.exists ? doc.data() : null;
}

async function cleanup(): Promise<void> {
  console.log('\n🧹 Cleaning up test data...');
  const batch = db.batch();

  // Token doc
  batch.delete(db.collection('iao-tokens').doc(TEST_TOKEN.toLowerCase()));

  // Earnings docs
  for (const user of TEST_USERS) {
    const docId = `${TEST_TOKEN.toLowerCase()}#${user.address.toLowerCase()}`;
    batch.delete(db.collection('token-earnings').doc(docId));
  }

  // Merkle tree doc
  batch.delete(db.collection('merkle-trees').doc(TEST_TOKEN.toLowerCase()));

  // Graduation lock doc
  batch.delete(db.collection('graduation-locks').doc(TEST_TOKEN.toLowerCase()));

  await batch.commit();
  console.log('  ✅ Test data cleaned up');
}

// ─────────────────────────────────────────────────────
// Test stages
// ─────────────────────────────────────────────────────

async function stage1_seed() {
  console.log('\n📦 Stage 1: Seed test data');
  await seedTestToken();
  await seedTestEarnings();

  const token = await getTokenDoc();
  assert(token !== null, 'Token doc created');
  assert(token?.virtualTokensDistributed === NEAR_THRESHOLD.toString(), `Virtual distributed is near threshold (${NEAR_THRESHOLD})`);
  assert(token?.graduated === false, 'Token is not yet graduated');
  assert(token?.distributionModel === 'merkle', 'Distribution model is merkle');
}

async function stage2_verifyThresholdNotCrossed() {
  console.log('\n📊 Stage 2: Verify threshold is not yet crossed');
  const token = await getTokenDoc();
  const current = BigInt(token?.virtualTokensDistributed || '0');
  assert(current < GRADUATION_THRESHOLD, `Current (${current}) < Threshold (${GRADUATION_THRESHOLD})`);
}

async function stage3_incrementToThreshold() {
  console.log('\n⬆️  Stage 3: Increment virtualTokensDistributed past threshold');

  // Directly update the token doc to simulate the increment
  // (In production, this happens inside the proxy's post-payment block)
  const docRef = db.collection('iao-tokens').doc(TEST_TOKEN.toLowerCase());
  const newTotal = (NEAR_THRESHOLD + PUSH_OVER_AMOUNT).toString();

  await docRef.update({
    virtualTokensDistributed: newTotal,
    updatedAt: new Date().toISOString(),
  });

  const token = await getTokenDoc();
  const current = BigInt(token?.virtualTokensDistributed || '0');
  assert(current >= GRADUATION_THRESHOLD, `Threshold crossed: ${current} >= ${GRADUATION_THRESHOLD}`);
  assert(token?.graduated === false, 'Still not graduated (dispatch not yet triggered)');
}

async function stage4_callGraduateEndpoint() {
  console.log('\n🎓 Stage 4: Call POST /internal/graduate/:tokenAddress');

  const result = await post(`/internal/graduate/${TEST_TOKEN}`, {
    tokenAddress: TEST_TOKEN,
    chainId: TEST_CHAIN,
    virtualDistributed: (NEAR_THRESHOLD + PUSH_OVER_AMOUNT).toString(),
    totalFeesCollected: '100000000',
  });

  // The endpoint will succeed for Merkle tree building but Lambda invocation will fail
  // (no AWS credentials locally). The endpoint catches this and still returns success
  // because the Merkle tree was built and stored.
  console.log(`  Response: ${result.status} ${JSON.stringify(result.data)}`);

  if (result.status === 200) {
    assert(true, `Graduation endpoint returned 200`);
    assert(result.data?.merkleRoot !== undefined, `Merkle root returned: ${result.data?.merkleRoot}`);
    assert(result.data?.totalLeaves === TEST_USERS.length, `Total leaves: ${result.data?.totalLeaves}`);
  } else if (result.status === 500) {
    // Lambda invocation failure — check if Merkle tree was still built
    console.log('  ⚠️  Endpoint returned 500 (likely Lambda invocation failed — expected locally)');

    const merkle = await getMerkleDoc();
    if (merkle) {
      assert(true, 'Merkle tree was built before Lambda error');
      assert(merkle.merkleRoot !== undefined, `Merkle root: ${merkle.merkleRoot}`);
      assert(merkle.totalLeaves === TEST_USERS.length, `Total leaves: ${merkle.totalLeaves}`);
    } else {
      assert(false, 'Merkle tree was NOT built — graduation failed early');
    }
  } else {
    assert(false, `Unexpected status: ${result.status}`);
  }
}

async function stage5_verifyMerkleTree() {
  console.log('\n🌳 Stage 5: Verify Merkle tree in Firestore');

  const merkle = await getMerkleDoc();
  assert(merkle !== null, 'Merkle tree document exists');
  assert(typeof merkle?.merkleRoot === 'string' && merkle.merkleRoot.startsWith('0x'), `Merkle root is valid hex: ${merkle?.merkleRoot}`);
  assert(merkle?.totalLeaves === TEST_USERS.length, `Correct leaf count: ${merkle?.totalLeaves}`);
  assert(merkle?.chainId === TEST_CHAIN, `Chain ID matches: ${merkle?.chainId}`);
  assert(Array.isArray(merkle?.leaves), 'Leaves array exists');
  assert(typeof merkle?.treeDump === 'string', 'Tree dump stored for proof generation');

  // Verify each user is in the leaves
  if (merkle?.leaves) {
    for (const user of TEST_USERS) {
      const leaf = merkle.leaves.find((l: any) => l.address === user.address.toLowerCase());
      assert(leaf !== undefined, `User ${user.address.slice(0, 16)}... found in leaves`);
      assert(leaf?.amount === user.tokens, `Correct token amount for ${user.address.slice(0, 16)}...`);
    }
  }

  // Verify token doc has merkleRoot set
  const token = await getTokenDoc();
  assert(token?.merkleRoot === merkle?.merkleRoot, 'Token doc has merkleRoot set');
  assert(token?.graduated === false, 'Token is NOT yet graduated (Lambda hasn\'t confirmed)');
}

async function stage6_simulateLambdaCallback() {
  console.log('\n📞 Stage 6: Simulate Lambda callback (graduation-confirm)');

  const fakeTxHash = '0x' + 'a'.repeat(64);
  const result = await post(`/internal/graduation-confirm/${TEST_TOKEN}`, {
    txHash: fakeTxHash,
  });

  console.log(`  Response: ${result.status} ${JSON.stringify(result.data)}`);
  assert(result.status === 200, 'Confirmation endpoint returned 200');
  assert(result.data?.status === 'confirmed', 'Status is confirmed');
}

async function stage7_verifyGraduated() {
  console.log('\n🏁 Stage 7: Verify token is graduated');

  const token = await getTokenDoc();
  assert(token?.graduated === true, 'Token graduated=true');

  const merkle = await getMerkleDoc();
  assert(merkle !== null, 'Merkle tree still exists');
}

async function stage8_testIdempotency() {
  console.log('\n🔁 Stage 8: Test idempotency (re-call graduate on already graduated token)');

  const result = await post(`/internal/graduate/${TEST_TOKEN}`, {
    tokenAddress: TEST_TOKEN,
    chainId: TEST_CHAIN,
  });

  console.log(`  Response: ${result.status} ${JSON.stringify(result.data)}`);
  assert(result.status === 200, 'Returns 200 (not error)');
  assert(result.data?.status === 'already_graduated', 'Status is already_graduated');
}

async function stage9_testAuthRejection() {
  console.log('\n🔒 Stage 9: Test auth rejection');

  if (!process.env.GRADUATION_INTERNAL_SECRET) {
    console.log('  ⏭️  Skipped — GRADUATION_INTERNAL_SECRET not set in .env (auth check is disabled)');
    console.log('     Add GRADUATION_INTERNAL_SECRET=test-secret to .env and restart backend to test this');
    return;
  }

  const resp = await fetch(`${BASE_URL}/internal/graduate/${TEST_TOKEN}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Graduation-Secret': 'wrong-secret',
    },
    body: JSON.stringify({ tokenAddress: TEST_TOKEN }),
  });

  assert(resp.status === 401, `Auth rejection returns 401 (got ${resp.status})`);
}

async function stage10_testEarningsEndpoint() {
  console.log('\n📈 Stage 10: Test graduation-earnings endpoint');

  // Re-seed earnings since they might still exist
  const result = await get(`/internal/graduation-earnings/${TEST_TOKEN}`);

  console.log(`  Response: ${result.status}, earnings count: ${result.data?.earnings?.length}`);
  assert(result.status === 200, 'Earnings endpoint returns 200');
  assert(Array.isArray(result.data?.earnings), 'Returns earnings array');
  assert(result.data?.earnings?.length === TEST_USERS.length, `Correct earnings count: ${result.data?.earnings?.length}`);
}

// ─────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Graduation E2E Local Test');
  console.log(`  Backend: ${BASE_URL}`);
  console.log(`  Token:   ${TEST_TOKEN}`);
  console.log(`  Slug:    ${TEST_SLUG}`);
  console.log('═══════════════════════════════════════════');

  // Check backend is running
  try {
    const health = await fetch(`${BASE_URL}/health`);
    if (!health.ok) throw new Error(`Health check failed: ${health.status}`);
    console.log('\n✅ Backend is running');
  } catch (err: any) {
    console.error(`\n❌ Backend not reachable at ${BASE_URL}: ${err.message}`);
    console.error('   Start the backend first: yarn dev');
    process.exit(1);
  }

  try {
    await stage1_seed();
    await stage2_verifyThresholdNotCrossed();
    await stage3_incrementToThreshold();
    await stage4_callGraduateEndpoint();
    await stage5_verifyMerkleTree();
    await stage6_simulateLambdaCallback();
    await stage7_verifyGraduated();
    await stage8_testIdempotency();
    await stage9_testAuthRejection();
    await stage10_testEarningsEndpoint();
  } catch (err: any) {
    console.error(`\n💥 Unexpected error: ${err.message}`);
    console.error(err.stack);
  } finally {
    await cleanup();
  }

  console.log('\n═══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main();
