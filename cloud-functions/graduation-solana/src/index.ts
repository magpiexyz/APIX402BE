/**
 * Solana Graduation Cloud Function
 *
 * Receives graduation events via HTTP POST and executes on-chain graduation by:
 *   1. Calling graduate_with_merkle to set merkle root and mark graduated
 *   2. Calling distribute_fees to split accumulated fees to builder/team/buyback
 *   3. POSTing back to /internal/graduation-confirm/:tokenAddress
 *
 * This mirrors the EVM graduation cloud function flow:
 *   EVM:    TokenDistributor.graduateTokenWithMerkle() + distributeFees()
 *   Solana: iao_factory.graduate_with_merkle()        + distribute_fees()
 *
 * Environment variables:
 *   AUTOMATION_PRIVATE_KEY         - Base58-encoded private key of automation wallet
 *   SOLANA_RPC_URL                 - Solana RPC endpoint
 *   IAO_PROGRAM_ID                 - IAO Factory program ID (FpCX6E1LxRph23NJgF9R8haRJscGPbbdhP2vd5Sn6jwA)
 *   BACKEND_URL                    - Cloud Run service URL
 *   GRADUATION_INTERNAL_SECRET     - Shared secret for internal endpoints
 */

import { HttpFunction } from '@google-cloud/functions-framework';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';

interface GraduationEvent {
  action: string;
  tokenAddress: string;
  chainId: string;
  merkleRoot: string;
  virtualDistributed: string;
  totalFeesCollected: string;
}

function getProgramId(): PublicKey {
  return new PublicKey(process.env.IAO_PROGRAM_ID || 'FpCX6E1LxRph23NJgF9R8haRJscGPbbdhP2vd5Sn6jwA');
}

// --- PDA Derivation ---

function deriveFactoryStatePDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('factory')], programId);
}

function deriveMintAuthorityPDA(tokenStatePubkey: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mint-authority'), tokenStatePubkey.toBuffer()],
    programId,
  );
}

function deriveFeeConfigPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('fee-config')], programId);
}

function deriveVaultPDA(tokenStatePubkey: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), tokenStatePubkey.toBuffer()],
    programId,
  );
}

function deriveVaultAuthorityPDA(tokenStatePubkey: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault-authority'), tokenStatePubkey.toBuffer()],
    programId,
  );
}

// --- Borsh Encoding Helpers ---

function encodeFixedBytes32(hex: string): Buffer {
  // Accept hex string (with or without 0x prefix) and return 32-byte buffer
  const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex;
  const buf = Buffer.from(cleaned, 'hex');
  if (buf.length !== 32) {
    throw new Error(`Expected 32-byte merkle root, got ${buf.length} bytes`);
  }
  return buf;
}

function encodeU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value, 0);
  return buf;
}

// --- Token State Decoding ---

interface DecodedTokenState {
  serverSlug: string;
  mint: PublicKey;
  builder: PublicKey;
}

function decodeTokenState(data: Buffer): DecodedTokenState {
  let pos = 8; // Skip Anchor discriminator

  // server_slug: String (4-byte length prefix + utf8)
  const slugLen = data.readUInt32LE(pos);
  pos += 4;
  const serverSlug = data.subarray(pos, pos + slugLen).toString('utf8');
  pos += slugLen;

  // name: String
  const nameLen = data.readUInt32LE(pos);
  pos += 4 + nameLen;

  // symbol: String
  const symbolLen = data.readUInt32LE(pos);
  pos += 4 + symbolLen;

  // mint: Pubkey (32 bytes)
  const mint = new PublicKey(data.subarray(pos, pos + 32));
  pos += 32;

  // builder: Pubkey (32 bytes)
  const builder = new PublicKey(data.subarray(pos, pos + 32));

  return { serverSlug, mint, builder };
}

// --- Fee Config Decoding ---

interface DecodedFeeConfig {
  teamAddress: PublicKey;
  buybackAddress: PublicKey;
}

function decodeFeeConfig(data: Buffer): DecodedFeeConfig {
  let pos = 8; // Skip Anchor discriminator

  // team_address: Pubkey (32 bytes)
  const teamAddress = new PublicKey(data.subarray(pos, pos + 32));
  pos += 32;

  // buyback_address: Pubkey (32 bytes)
  const buybackAddress = new PublicKey(data.subarray(pos, pos + 32));

  return { teamAddress, buybackAddress };
}

// --- Instructions ---

async function callGraduateWithMerkle(
  connection: Connection,
  automationWallet: Keypair,
  programId: PublicKey,
  factoryState: PublicKey,
  tokenState: PublicKey,
  merkleRoot: string,
  virtualDistributed: bigint,
  totalFeesCollected: bigint,
): Promise<string> {
  const { createHash } = await import('crypto');
  const discriminator = createHash('sha256')
    .update('global:graduate_with_merkle')
    .digest()
    .subarray(0, 8);

  const instructionData = Buffer.concat([
    discriminator,
    encodeFixedBytes32(merkleRoot),
    encodeU64(virtualDistributed),
    encodeU64(totalFeesCollected),
  ]);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: factoryState, isSigner: false, isWritable: false },
      { pubkey: tokenState, isSigner: false, isWritable: true },
      { pubkey: automationWallet.publicKey, isSigner: true, isWritable: false },
    ],
    data: instructionData,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [automationWallet], {
    commitment: 'confirmed',
  });

  return sig;
}

async function callDistributeFees(
  connection: Connection,
  automationWallet: Keypair,
  programId: PublicKey,
  factoryState: PublicKey,
  tokenState: PublicKey,
  feeConfig: PublicKey,
  vault: PublicKey,
  vaultAuthority: PublicKey,
  builderUsdcAccount: PublicKey,
  teamUsdcAccount: PublicKey,
  buybackUsdcAccount: PublicKey | null,
): Promise<string> {
  const { createHash } = await import('crypto');
  const discriminator = createHash('sha256')
    .update('global:distribute_fees')
    .digest()
    .subarray(0, 8);

  const keys = [
    { pubkey: factoryState, isSigner: false, isWritable: false },
    { pubkey: tokenState, isSigner: false, isWritable: true },
    { pubkey: feeConfig, isSigner: false, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: builderUsdcAccount, isSigner: false, isWritable: true },
    { pubkey: teamUsdcAccount, isSigner: false, isWritable: true },
  ];

  // Buyback account is optional (Anchor Option<Account>)
  if (buybackUsdcAccount) {
    keys.push({ pubkey: buybackUsdcAccount, isSigner: false, isWritable: true });
  }

  keys.push(
    { pubkey: automationWallet.publicKey, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  );

  const ix = new TransactionInstruction({
    programId,
    keys,
    data: discriminator,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [automationWallet], {
    commitment: 'confirmed',
  });

  return sig;
}

// --- Main Cloud Function ---

export const graduateSolana: HttpFunction = async (req, res) => {
  // Verify shared secret
  const expectedSecret = process.env.GRADUATION_INTERNAL_SECRET;
  if (expectedSecret) {
    const providedSecret = req.headers['x-graduation-secret'];
    if (providedSecret !== expectedSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const event: GraduationEvent = req.body;
  console.log('Solana graduation event received:', JSON.stringify(event));

  if (event.action !== 'graduate') {
    res.status(400).json({ error: `Unknown action: ${event.action}` });
    return;
  }

  const { tokenAddress, merkleRoot, virtualDistributed, totalFeesCollected } = event;

  const privateKey = process.env.AUTOMATION_PRIVATE_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const backendUrl = process.env.BACKEND_URL;
  const internalSecret = process.env.GRADUATION_INTERNAL_SECRET;

  if (!privateKey || !rpcUrl) {
    console.error('Missing required environment variables');
    res.status(500).json({ error: 'Missing env vars' });
    return;
  }

  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const automationWallet = Keypair.fromSecretKey(bs58.decode(privateKey));
    const programId = getProgramId();

    // Derive factory PDA
    const [factoryState] = deriveFactoryStatePDA(programId);

    // Fetch and decode token state
    const tokenStatePubkey = new PublicKey(tokenAddress);
    const tokenStateInfo = await connection.getAccountInfo(tokenStatePubkey);
    if (!tokenStateInfo) {
      throw new Error(`Token state account not found: ${tokenAddress}`);
    }

    const { serverSlug, mint, builder } = decodeTokenState(tokenStateInfo.data);
    console.log(`Token: serverSlug=${serverSlug}, mint=${mint.toBase58()}, builder=${builder.toBase58()}`);

    // Step 1: Call graduate_with_merkle (mirrors EVM's graduateTokenWithMerkle)
    console.log(`Calling graduate_with_merkle(${merkleRoot}, ${virtualDistributed}, ${totalFeesCollected})`);

    const graduationSig = await callGraduateWithMerkle(
      connection,
      automationWallet,
      programId,
      factoryState,
      tokenStatePubkey,
      merkleRoot,
      BigInt(virtualDistributed),
      BigInt(totalFeesCollected),
    );
    console.log(`graduate_with_merkle confirmed: ${graduationSig}`);

    // Step 2: Distribute fees after graduation (mirrors EVM's distributeFees)
    // The fees collected during bonding curve need to be distributed
    try {
      const feesToDistribute = BigInt(totalFeesCollected);
      if (feesToDistribute > 0n) {
        console.log(`Distributing fees: ${feesToDistribute.toString()} for token ${tokenAddress}`);

        // Derive fee-related PDAs
        const [feeConfig] = deriveFeeConfigPDA(programId);
        const [vault] = deriveVaultPDA(tokenStatePubkey, programId);
        const [vaultAuthority] = deriveVaultAuthorityPDA(tokenStatePubkey, programId);

        // Fetch fee config to get team and buyback addresses
        const feeConfigInfo = await connection.getAccountInfo(feeConfig);
        if (!feeConfigInfo) {
          throw new Error('FeeConfig account not found');
        }
        const { teamAddress, buybackAddress } = decodeFeeConfig(feeConfigInfo.data);

        // Fetch payment token mint from factory state
        const factoryInfo = await connection.getAccountInfo(factoryState);
        if (!factoryInfo) throw new Error('Factory state not found');
        // Skip discriminator(8) + admin(32) + automationWallet(32) = 72
        const paymentTokenMint = new PublicKey(factoryInfo.data.subarray(72, 104));

        // Derive USDC ATAs for builder, team, and buyback
        const builderUsdcAccount = await getAssociatedTokenAddress(paymentTokenMint, builder);
        const teamUsdcAccount = await getAssociatedTokenAddress(paymentTokenMint, teamAddress);
        const buybackUsdcAccount = await getAssociatedTokenAddress(paymentTokenMint, buybackAddress);

        const feeSig = await callDistributeFees(
          connection,
          automationWallet,
          programId,
          factoryState,
          tokenStatePubkey,
          feeConfig,
          vault,
          vaultAuthority,
          builderUsdcAccount,
          teamUsdcAccount,
          buybackUsdcAccount,
        );
        console.log(`distribute_fees confirmed: ${feeSig}`);
      } else {
        console.log('No fees to distribute');
      }
    } catch (feeErr: any) {
      // Log but don't fail the graduation - fees can be distributed later
      console.error(`Fee distribution failed (graduation succeeded): ${feeErr.message}`);
    }

    // Step 3: Notify backend of successful graduation
    if (backendUrl) {
      try {
        const confirmUrl = `${backendUrl}/internal/graduation-confirm/${tokenAddress}`;
        const response = await fetch(confirmUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(internalSecret ? { 'X-Graduation-Secret': internalSecret } : {}),
          },
          body: JSON.stringify({ txHash: graduationSig }),
        });

        if (!response.ok) {
          console.error(`Confirmation POST failed: ${response.status} ${response.statusText}`);
        } else {
          console.log(`Backend confirmation sent for ${tokenAddress}`);
        }
      } catch (confirmErr) {
        console.error('Failed to notify backend (graduation tx already succeeded):', confirmErr);
      }
    }

    res.status(200).json({
      status: 'graduated',
      txHash: graduationSig,
      tokenAddress,
    });
  } catch (err: any) {
    console.error('Solana graduation failed:', err);
    res.status(500).json({
      error: 'Graduation failed',
      message: err.message,
      tokenAddress,
    });
  }
};
