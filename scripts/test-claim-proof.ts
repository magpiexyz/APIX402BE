/**
 * Test the generateProof logic for both Solana (keccak256) and EVM (OZ StandardMerkleTree) formats.
 * This tests the exact code path that /api/claim/:serverSlug/:userAddress uses.
 *
 * Usage: npx tsx scripts/test-claim-proof.ts
 */

import { keccak_256 } from '@noble/hashes/sha3'
import bs58 from 'bs58'
import { Keypair } from '@solana/web3.js'

// ─── Reproduce the normalizeAddress utility ───
function normalizeAddress(address: string): string {
  if (address.startsWith('0x')) {
    return address.toLowerCase()
  }
  return address
}

// ─── Reproduce the Solana Merkle tree builder from index.ts ───

const DECIMAL_SHIFT = BigInt(10 ** 9)

function toSolanaAmount(amount18: string): bigint {
  return BigInt(amount18) / DECIMAL_SHIFT
}

function hashLeaf(userAddress: string, solanaAmount: bigint): Buffer {
  const pubkeyBytes = bs58.decode(userAddress)
  const amountBuf = Buffer.alloc(8)
  amountBuf.writeBigUInt64LE(solanaAmount)
  const leafData = Buffer.concat([Buffer.from(pubkeyBytes), amountBuf])
  const innerHash = keccak_256(leafData)
  return Buffer.from(keccak_256(innerHash))
}

function keccak256Combine(left: Buffer, right: Buffer): Buffer {
  const combined = Buffer.compare(left, right) <= 0
    ? Buffer.concat([left, right])
    : Buffer.concat([right, left])
  return Buffer.from(keccak_256(combined))
}

// ─── Reproduce the generateProof logic from firestoreMerkleTreeService.ts ───

interface MerkleLeaf {
  address: string
  amount: string
  index: number
}

interface MerkleTreeEntry {
  id: string
  merkleRoot: string
  totalLeaves: number
  totalTokens: string
  leaves: MerkleLeaf[]
  treeDump: string
  generatedAt: string
  chainId: string
}

async function generateProof(
  tree: MerkleTreeEntry,
  userAddress: string
): Promise<{ proof: string[]; amount: string; index: number } | null> {
  // Find the leaf for this user
  const normalizedUser = normalizeAddress(userAddress)
  const leaf = tree.leaves.find(l => normalizeAddress(l.address) === normalizedUser)
  if (!leaf) {
    return null
  }

  try {
    const dump = JSON.parse(tree.treeDump)

    // Solana trees store pre-computed proofs in the dump
    if (dump.format === 'solana-keccak256') {
      const solanaLeaf = dump.leaves.find(
        (l: { address: string; proof: string[] }) => normalizeAddress(l.address) === normalizedUser
      )
      if (!solanaLeaf || !solanaLeaf.proof) {
        return null
      }
      return {
        proof: solanaLeaf.proof,
        amount: leaf.amount,
        index: leaf.index,
      }
    }

    // EVM trees use OZ StandardMerkleTree
    const { StandardMerkleTree } = await import('@openzeppelin/merkle-tree')
    const loadedTree = StandardMerkleTree.load(dump)

    for (const [i, value] of loadedTree.entries()) {
      if (normalizeAddress(value[0] as string) === normalizedUser) {
        const proof = loadedTree.getProof(i)
        return {
          proof,
          amount: leaf.amount,
          index: leaf.index,
        }
      }
    }

    return null
  } catch (err) {
    console.error(`❌ Failed to generate proof for ${userAddress}:`, err)
    return null
  }
}

// ─── On-chain verifier simulation (same as test-solana-merkle.ts) ───

function verifyProofOnChain(
  userPubkey: string,
  amount: bigint,
  proof: string[], // hex strings with 0x prefix
  merkleRoot: string
): boolean {
  const pubkeyBytes = bs58.decode(userPubkey)
  const amountBuf = Buffer.alloc(8)
  amountBuf.writeBigUInt64LE(amount)

  const leafData = Buffer.concat([Buffer.from(pubkeyBytes), amountBuf])
  const innerHash = Buffer.from(keccak_256(leafData))
  const leaf = Buffer.from(keccak_256(innerHash))

  let computedHash = Buffer.from(leaf)
  for (const proofHex of proof) {
    const proofElement = Buffer.from(proofHex.replace('0x', ''), 'hex')
    if (Buffer.compare(computedHash, proofElement) <= 0) {
      computedHash = Buffer.from(keccak_256(Buffer.concat([computedHash, proofElement])))
    } else {
      computedHash = Buffer.from(keccak_256(Buffer.concat([proofElement, computedHash])))
    }
  }

  return '0x' + computedHash.toString('hex') === merkleRoot
}

// ─── Build a Solana tree (same as index.ts) and store it, then test generateProof ───

function buildSolanaTreeEntry(
  earnings: { userAddress: string; totalTokensEarned: string }[],
  chainId: string
): MerkleTreeEntry {
  const sortedLeaves = earnings.map(e => {
    const solanaAmount = toSolanaAmount(e.totalTokensEarned)
    return {
      address: e.userAddress,
      amount: solanaAmount.toString(),
      hash: hashLeaf(e.userAddress, solanaAmount),
    }
  }).sort((a, b) => Buffer.compare(a.hash, b.hash))

  let currentLevel = sortedLeaves.map(l => l.hash)
  const allLevels = [currentLevel]
  while (currentLevel.length > 1) {
    const nextLevel: Buffer[] = []
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(keccak256Combine(currentLevel[i], currentLevel[i + 1]))
      } else {
        nextLevel.push(currentLevel[i])
      }
    }
    currentLevel = nextLevel
    allLevels.push(currentLevel)
  }

  const merkleRoot = '0x' + currentLevel[0].toString('hex')

  const proofs: { [address: string]: string[] } = {}
  for (let leafIdx = 0; leafIdx < sortedLeaves.length; leafIdx++) {
    const proof: string[] = []
    let idx = leafIdx
    for (let level = 0; level < allLevels.length - 1; level++) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1
      if (siblingIdx < allLevels[level].length) {
        proof.push('0x' + allLevels[level][siblingIdx].toString('hex'))
      }
      idx = Math.floor(idx / 2)
    }
    proofs[sortedLeaves[leafIdx].address] = proof
  }

  const treeDump = JSON.stringify({
    format: 'solana-keccak256',
    root: merkleRoot,
    leaves: sortedLeaves.map((l, i) => ({
      address: l.address,
      amount: l.amount,
      hash: '0x' + l.hash.toString('hex'),
      proof: proofs[l.address],
    })),
  })

  const SOLANA_SHIFT = BigInt(10 ** 9)
  const totalTokens18 = earnings.reduce((sum, e) => sum + BigInt(e.totalTokensEarned), BigInt(0))

  return {
    id: 'test-token',
    merkleRoot,
    totalLeaves: earnings.length,
    totalTokens: (totalTokens18 / SOLANA_SHIFT).toString(),
    leaves: earnings.map((e, i) => ({
      address: e.userAddress,
      amount: (BigInt(e.totalTokensEarned) / SOLANA_SHIFT).toString(),
      index: i,
    })),
    treeDump,
    generatedAt: new Date().toISOString(),
    chainId,
  }
}

// ─── Tests ───

async function testSolanaSingleUser() {
  console.log('\n══ TEST: Solana single user claim ══')
  const addr = 'AbtfQk8fg751wU4W7mn6yd98yL1QkTLj7TyoooswQw28'
  const tree = buildSolanaTreeEntry(
    [{ userAddress: addr, totalTokensEarned: '500000000000000000000' }],
    'solana-devnet'
  )

  const result = await generateProof(tree, addr)
  if (!result) {
    console.log('  ❌ FAIL: generateProof returned null')
    return false
  }

  console.log(`  proof length: ${result.proof.length}`)
  console.log(`  amount: ${result.amount}`)
  console.log(`  index: ${result.index}`)

  // Verify proof on-chain
  const valid = verifyProofOnChain(addr, BigInt(result.amount), result.proof, tree.merkleRoot)
  console.log(`  on-chain verify: ${valid ? '✅' : '❌'}`)

  if (!valid) return false

  // Wrong user should get null
  const wrongResult = await generateProof(tree, Keypair.generate().publicKey.toBase58())
  if (wrongResult !== null) {
    console.log('  ❌ FAIL: wrong user got a proof')
    return false
  }
  console.log('  wrong user returns null: ✅')

  return true
}

async function testSolanaMultipleUsers() {
  console.log('\n══ TEST: Solana 5 users claim ══')
  const users = [
    { userAddress: 'AbtfQk8fg751wU4W7mn6yd98yL1QkTLj7TyoooswQw28', totalTokensEarned: '500000000000000000000' },
    { userAddress: Keypair.generate().publicKey.toBase58(), totalTokensEarned: '250000000000000000000' },
    { userAddress: Keypair.generate().publicKey.toBase58(), totalTokensEarned: '100000000000000000000' },
    { userAddress: Keypair.generate().publicKey.toBase58(), totalTokensEarned: '75000000000000000000' },
    { userAddress: Keypair.generate().publicKey.toBase58(), totalTokensEarned: '10000000000000000000' },
  ]

  const tree = buildSolanaTreeEntry(users, 'solana-devnet')

  let allPassed = true
  for (const user of users) {
    const result = await generateProof(tree, user.userAddress)
    if (!result) {
      console.log(`  ❌ FAIL: ${user.userAddress.slice(0, 12)}... returned null`)
      allPassed = false
      continue
    }

    const valid = verifyProofOnChain(
      user.userAddress,
      BigInt(result.amount),
      result.proof,
      tree.merkleRoot
    )
    const status = valid ? '✅' : '❌'
    console.log(`  ${status} ${user.userAddress.slice(0, 12)}... amount=${result.amount} proof_len=${result.proof.length}`)
    if (!valid) allPassed = false
  }

  return allPassed
}

async function testEVMTree() {
  console.log('\n══ TEST: EVM tree (OZ StandardMerkleTree) ══')
  const { StandardMerkleTree } = await import('@openzeppelin/merkle-tree')

  const leaves: [string, string][] = [
    ['0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B', '1000000000000000000000'],
    ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '500000000000000000000'],
    ['0x1234567890abcdef1234567890abcdef12345678', '250000000000000000000'],
  ]

  const ozTree = StandardMerkleTree.of(leaves, ['address', 'uint256'])
  const treeDump = JSON.stringify(ozTree.dump())

  const treeEntry: MerkleTreeEntry = {
    id: '0xtest',
    merkleRoot: ozTree.root,
    totalLeaves: leaves.length,
    totalTokens: '1750000000000000000000',
    leaves: leaves.map(([addr, amt], i) => ({
      address: addr.toLowerCase(),
      amount: amt,
      index: i,
    })),
    treeDump,
    generatedAt: new Date().toISOString(),
    chainId: '84532',
  }

  let allPassed = true
  for (const [addr, expectedAmt] of leaves) {
    const result = await generateProof(treeEntry, addr)
    if (!result) {
      console.log(`  ❌ FAIL: ${addr.slice(0, 12)}... returned null`)
      allPassed = false
      continue
    }

    // Verify using OZ
    const valid = ozTree.verify(
      [addr, expectedAmt],
      result.proof
    )
    const status = valid ? '✅' : '❌'
    console.log(`  ${status} ${addr.slice(0, 12)}... amount=${result.amount} proof_len=${result.proof.length}`)
    if (!valid) allPassed = false
  }

  // Wrong user should get null
  const wrongResult = await generateProof(treeEntry, '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
  if (wrongResult !== null) {
    console.log('  ❌ FAIL: wrong EVM user got a proof')
    allPassed = false
  } else {
    console.log('  wrong user returns null: ✅')
  }

  return allPassed
}

async function testEdgeCases() {
  console.log('\n══ TEST: Edge cases ══')
  let allPassed = true

  // Test: Solana address is NOT lowercased
  const solanaAddr = 'AbtfQk8fg751wU4W7mn6yd98yL1QkTLj7TyoooswQw28'
  const normalized = normalizeAddress(solanaAddr)
  if (normalized !== solanaAddr) {
    console.log(`  ❌ FAIL: Solana address was modified: ${normalized}`)
    allPassed = false
  } else {
    console.log('  Solana address preserved: ✅')
  }

  // Test: EVM address IS lowercased
  const evmAddr = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'
  const normalizedEvm = normalizeAddress(evmAddr)
  if (normalizedEvm !== evmAddr.toLowerCase()) {
    console.log(`  ❌ FAIL: EVM address was not lowercased: ${normalizedEvm}`)
    allPassed = false
  } else {
    console.log('  EVM address lowercased: ✅')
  }

  // Test: Empty tree dump handling
  const emptyTree: MerkleTreeEntry = {
    id: 'empty',
    merkleRoot: '0x00',
    totalLeaves: 0,
    totalTokens: '0',
    leaves: [],
    treeDump: JSON.stringify({ format: 'solana-keccak256', root: '0x00', leaves: [] }),
    generatedAt: new Date().toISOString(),
    chainId: 'solana-devnet',
  }
  const emptyResult = await generateProof(emptyTree, solanaAddr)
  if (emptyResult !== null) {
    console.log('  ❌ FAIL: empty tree returned a proof')
    allPassed = false
  } else {
    console.log('  empty tree returns null: ✅')
  }

  return allPassed
}

// ─── Run All ───

async function main() {
  console.log('Claim Proof Generation Tests')
  console.log('============================')
  console.log('Tests the exact generateProof logic used by /api/claim endpoint\n')

  let passed = 0
  let total = 0

  total++; if (await testSolanaSingleUser()) passed++
  total++; if (await testSolanaMultipleUsers()) passed++
  total++; if (await testEVMTree()) passed++
  total++; if (await testEdgeCases()) passed++

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`RESULTS: ${passed}/${total} test groups passed`)
  console.log(`${'═'.repeat(50)}`)

  if (passed === total) {
    console.log('\n✅ All claim proof tests passed.')
    process.exit(0)
  } else {
    console.log('\n❌ Some tests failed.')
    process.exit(1)
  }
}

main()
