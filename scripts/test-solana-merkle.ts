/**
 * Solana Merkle Tree Verification Test
 *
 * Tests that the off-chain Merkle tree builder (backend) produces proofs
 * that match the on-chain verifier (merkle_claim.rs).
 *
 * On-chain logic (merkle_claim.rs):
 *   leaf_data = [user_pubkey_bytes(32) || amount_u64_le(8)]
 *   inner_hash = keccak256(leaf_data)
 *   leaf = keccak256(inner_hash)       // double-hash for second preimage resistance
 *
 *   for proof_element in proof:
 *     if computed_hash <= proof_element:
 *       computed_hash = keccak256(computed_hash || proof_element)
 *     else:
 *       computed_hash = keccak256(proof_element || computed_hash)
 *
 *   assert computed_hash == merkle_root
 *
 * Usage: npx tsx scripts/test-solana-merkle.ts
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// ─── Merkle Tree Builder (mirrors backend src/index.ts) ───

const DECIMAL_SHIFT = BigInt(10 ** 9);

function toSolanaAmount(amount18: string): bigint {
  return BigInt(amount18) / DECIMAL_SHIFT;
}

function hashLeaf(userAddress: string, solanaAmount: bigint): Buffer {
  const pubkeyBytes = bs58.decode(userAddress);
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(solanaAmount);
  const leafData = Buffer.concat([Buffer.from(pubkeyBytes), amountBuf]);
  const innerHash = keccak_256(leafData);
  return Buffer.from(keccak_256(innerHash));
}

function keccak256Combine(left: Buffer, right: Buffer): Buffer {
  const combined = Buffer.compare(left, right) <= 0
    ? Buffer.concat([left, right])
    : Buffer.concat([right, left]);
  return Buffer.from(keccak_256(combined));
}

interface MerkleLeaf {
  address: string;
  amount: string; // 9-decimal Solana amount
  hash: Buffer;
}

interface MerkleTree {
  root: Buffer;
  leaves: MerkleLeaf[];
  proofs: Map<string, Buffer[]>;
}

function buildMerkleTree(earnings: { userAddress: string; totalTokensEarned: string }[]): MerkleTree {
  // Build sorted leaves (same as backend)
  const sortedLeaves: MerkleLeaf[] = earnings.map(e => {
    const solanaAmount = toSolanaAmount(e.totalTokensEarned);
    return {
      address: e.userAddress,
      amount: solanaAmount.toString(),
      hash: hashLeaf(e.userAddress, solanaAmount),
    };
  }).sort((a, b) => Buffer.compare(a.hash, b.hash));

  // Build tree bottom-up
  let currentLevel = sortedLeaves.map(l => l.hash);
  const allLevels = [currentLevel];
  while (currentLevel.length > 1) {
    const nextLevel: Buffer[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(keccak256Combine(currentLevel[i], currentLevel[i + 1]));
      } else {
        nextLevel.push(currentLevel[i]); // Odd node promoted
      }
    }
    currentLevel = nextLevel;
    allLevels.push(currentLevel);
  }

  const root = currentLevel[0];

  // Build proofs for each leaf
  const proofs = new Map<string, Buffer[]>();
  for (let leafIdx = 0; leafIdx < sortedLeaves.length; leafIdx++) {
    const proof: Buffer[] = [];
    let idx = leafIdx;
    for (let level = 0; level < allLevels.length - 1; level++) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (siblingIdx < allLevels[level].length) {
        proof.push(allLevels[level][siblingIdx]);
      }
      idx = Math.floor(idx / 2);
    }
    proofs.set(sortedLeaves[leafIdx].address, proof);
  }

  return { root, leaves: sortedLeaves, proofs };
}

// ─── On-Chain Verifier Simulation (mirrors merkle_claim.rs) ───

function verifyProofOnChain(
  userPubkey: string,
  amount: bigint,
  proof: Buffer[],
  merkleRoot: Buffer
): boolean {
  // Rebuild leaf exactly as on-chain program does
  const pubkeyBytes = bs58.decode(userPubkey);
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(amount);

  const leafData = Buffer.concat([Buffer.from(pubkeyBytes), amountBuf]);
  const innerHash = Buffer.from(keccak_256(leafData));
  const leaf = Buffer.from(keccak_256(innerHash));

  // Walk proof (same logic as merkle_claim.rs)
  let computedHash = Buffer.from(leaf);
  for (const proofElement of proof) {
    if (Buffer.compare(computedHash, proofElement) <= 0) {
      const combined = Buffer.concat([computedHash, proofElement]);
      computedHash = Buffer.from(keccak_256(combined));
    } else {
      const combined = Buffer.concat([proofElement, computedHash]);
      computedHash = Buffer.from(keccak_256(combined));
    }
  }

  return Buffer.compare(computedHash, merkleRoot) === 0;
}

// ─── Test Cases ───

function generateRandomAddress(): string {
  return Keypair.generate().publicKey.toBase58();
}

function runTest(name: string, earnings: { userAddress: string; totalTokensEarned: string }[]) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log(`${'═'.repeat(60)}`);

  const tree = buildMerkleTree(earnings);
  console.log(`Root: 0x${tree.root.toString('hex')}`);
  console.log(`Leaves: ${tree.leaves.length}`);

  let allPassed = true;

  for (const leaf of tree.leaves) {
    const proof = tree.proofs.get(leaf.address)!;
    const amount = BigInt(leaf.amount);

    // Verify using on-chain simulation
    const valid = verifyProofOnChain(leaf.address, amount, proof, tree.root);

    const status = valid ? '✅' : '❌';
    console.log(`  ${status} ${leaf.address.slice(0, 12)}... amount=${leaf.amount} proof_len=${proof.length}`);

    if (!valid) {
      allPassed = false;
      console.log(`     FAILED! Leaf hash: 0x${leaf.hash.toString('hex')}`);
      console.log(`     Proof: [${proof.map(p => '0x' + p.toString('hex').slice(0, 16) + '...').join(', ')}]`);
    }

    // Also verify with WRONG amount (should fail)
    // Skip if amount+1 would overflow u64
    const U64_MAX = BigInt("18446744073709551615");
    if (amount < U64_MAX) {
      const wrongAmount = amount + 1n;
      const invalidResult = verifyProofOnChain(leaf.address, wrongAmount, proof, tree.root);
      if (invalidResult) {
        allPassed = false;
        console.log(`  ❌ SECURITY FAIL: Wrong amount ${wrongAmount} verified as valid!`);
      }
    }

    // Verify with WRONG address (should fail)
    const wrongAddress = generateRandomAddress();
    const invalidAddr = verifyProofOnChain(wrongAddress, amount, proof, tree.root);
    if (invalidAddr) {
      allPassed = false;
      console.log(`  ❌ SECURITY FAIL: Wrong address verified as valid!`);
    }
  }

  if (allPassed) {
    console.log(`\n  ✅ ALL CHECKS PASSED (${tree.leaves.length} leaves verified + negative tests)`);
  } else {
    console.log(`\n  ❌ SOME CHECKS FAILED`);
  }

  return allPassed;
}

// ─── Run All Tests ───

console.log('Solana Merkle Tree Verification Tests');
console.log('=====================================');
console.log('Testing off-chain tree builder against on-chain verifier logic\n');

let totalPassed = 0;
let totalTests = 0;

// Test 1: Single user (simplest case — root = leaf hash)
totalTests++;
if (runTest('Single user', [
  { userAddress: 'AbtfQk8fg751wU4W7mn6yd98yL1QkTLj7TyoooswQw28', totalTokensEarned: '500000000000000000000' },
])) totalPassed++;

// Test 2: Two users (one level of hashing)
totalTests++;
if (runTest('Two users', [
  { userAddress: 'AbtfQk8fg751wU4W7mn6yd98yL1QkTLj7TyoooswQw28', totalTokensEarned: '500000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '250000000000000000000' },
])) totalPassed++;

// Test 3: Three users (odd number — tests promoted node)
totalTests++;
if (runTest('Three users (odd — tests promotion)', [
  { userAddress: generateRandomAddress(), totalTokensEarned: '100000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '200000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '300000000000000000000' },
])) totalPassed++;

// Test 4: Four users (power of 2 — balanced tree)
totalTests++;
if (runTest('Four users (balanced)', [
  { userAddress: generateRandomAddress(), totalTokensEarned: '100000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '200000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '300000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '400000000000000000000' },
])) totalPassed++;

// Test 5: Seven users (multiple levels, odd nodes)
totalTests++;
if (runTest('Seven users (multi-level, odd)', [
  { userAddress: generateRandomAddress(), totalTokensEarned: '10000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '20000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '30000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '40000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '50000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '60000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '70000000000000000000' },
])) totalPassed++;

// Test 6: Same amount for all users (tests sorting by hash not amount)
totalTests++;
if (runTest('Five users with same amount', [
  { userAddress: generateRandomAddress(), totalTokensEarned: '100000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '100000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '100000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '100000000000000000000' },
  { userAddress: generateRandomAddress(), totalTokensEarned: '100000000000000000000' },
])) totalPassed++;

// Test 7: Large amounts near u64 max (after conversion)
totalTests++;
const nearMaxU64 = (BigInt("18446744073709551615") * DECIMAL_SHIFT).toString(); // u64 max * 10^9
if (runTest('Large amount near u64 max', [
  { userAddress: generateRandomAddress(), totalTokensEarned: nearMaxU64 },
  { userAddress: generateRandomAddress(), totalTokensEarned: '1000000000000000000' },
])) totalPassed++;

// Test 8: Minimal amount (1 token in 18 decimals = 0 in 9 decimals — edge case!)
totalTests++;
if (runTest('Minimal amounts (dust — rounds to 0)', [
  { userAddress: generateRandomAddress(), totalTokensEarned: '999999999' }, // < 10^9, rounds to 0
  { userAddress: generateRandomAddress(), totalTokensEarned: '1000000000' }, // exactly 10^9, rounds to 1
  { userAddress: generateRandomAddress(), totalTokensEarned: '1000000000000000000' }, // 10^18 = 10^9 in Solana
])) totalPassed++;

console.log(`\n${'═'.repeat(60)}`);
console.log(`RESULTS: ${totalPassed}/${totalTests} test groups passed`);
console.log(`${'═'.repeat(60)}`);

if (totalPassed === totalTests) {
  console.log('\n✅ All Merkle tree tests passed! Off-chain proofs match on-chain verifier.');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed! DO NOT deploy to production.');
  process.exit(1);
}
