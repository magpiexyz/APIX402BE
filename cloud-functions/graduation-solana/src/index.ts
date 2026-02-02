/**
 * Solana Graduation Cloud Function
 *
 * Receives graduation events via HTTP POST and executes on-chain graduation by:
 *   1. Fetching earnings breakdown from the backend
 *   2. Calling batch_mint in chunks of 50 to distribute accumulated tokens
 *   3. Calling deploy_liquidity once threshold is crossed
 *   4. POSTing back to /internal/graduation-confirm/:tokenAddress
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
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import bs58 from 'bs58';

const MAX_BATCH_SIZE = 50;

interface GraduationEvent {
  action: string;
  tokenAddress: string;
  chainId: string;
  merkleRoot: string;
  virtualDistributed: string;
  totalFeesCollected: string;
}

interface EarningEntry {
  userAddress: string;
  totalTokensEarned: string;
}

function getProgramId(): PublicKey {
  return new PublicKey(process.env.IAO_PROGRAM_ID || 'FpCX6E1LxRph23NJgF9R8haRJscGPbbdhP2vd5Sn6jwA');
}

function deriveFactoryStatePDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('factory')], programId);
}

function deriveTokenStatePDA(serverSlug: string, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('iao-token'), Buffer.from(serverSlug)],
    programId,
  );
}

function deriveMintAuthorityPDA(tokenStatePubkey: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mint-authority'), tokenStatePubkey.toBuffer()],
    programId,
  );
}

async function fetchEarnings(backendUrl: string, tokenAddress: string, secret?: string): Promise<EarningEntry[]> {
  const url = `${backendUrl}/internal/graduation-earnings/${tokenAddress}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['X-Graduation-Secret'] = secret;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch earnings: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as { earnings: EarningEntry[] };
  return data.earnings;
}

async function batchMintChunk(
  connection: Connection,
  automationWallet: Keypair,
  programId: PublicKey,
  factoryState: PublicKey,
  tokenState: PublicKey,
  mint: PublicKey,
  mintAuthority: PublicKey,
  recipients: PublicKey[],
  amounts: bigint[],
  fees: bigint[],
): Promise<string> {
  const { createHash } = await import('crypto');
  const discriminator = createHash('sha256')
    .update('global:batch_mint')
    .digest()
    .subarray(0, 8);

  const recipientsData = encodeVecPublicKey(recipients);
  const amountsData = encodeVecU64(amounts);
  const feesData = encodeVecU64(fees);

  const instructionData = Buffer.concat([discriminator, recipientsData, amountsData, feesData]);

  const recipientATAs: PublicKey[] = [];
  const ataInstructions: TransactionInstruction[] = [];

  for (const recipient of recipients) {
    const ata = await getAssociatedTokenAddress(mint, recipient);
    recipientATAs.push(ata);

    const ataInfo = await connection.getAccountInfo(ata);
    if (!ataInfo) {
      ataInstructions.push(
        createAssociatedTokenAccountInstruction(
          automationWallet.publicKey,
          ata,
          recipient,
          mint,
        ),
      );
    }
  }

  const batchMintIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: factoryState, isSigner: false, isWritable: false },
      { pubkey: tokenState, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: automationWallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...recipientATAs.map((ata) => ({ pubkey: ata, isSigner: false, isWritable: true })),
    ],
    data: instructionData,
  });

  const tx = new Transaction();
  for (const ix of ataInstructions) {
    tx.add(ix);
  }
  tx.add(batchMintIx);

  const sig = await sendAndConfirmTransaction(connection, tx, [automationWallet], {
    commitment: 'confirmed',
  });

  return sig;
}

async function deployLiquidity(
  connection: Connection,
  automationWallet: Keypair,
  programId: PublicKey,
  factoryState: PublicKey,
  tokenState: PublicKey,
  mint: PublicKey,
  mintAuthority: PublicKey,
  paymentTokenMint: PublicKey,
): Promise<string> {
  const { createHash } = await import('crypto');
  const discriminator = createHash('sha256')
    .update('global:deploy_liquidity')
    .digest()
    .subarray(0, 8);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: factoryState, isSigner: false, isWritable: false },
      { pubkey: tokenState, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: paymentTokenMint, isSigner: false, isWritable: false },
      { pubkey: automationWallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [automationWallet], {
    commitment: 'confirmed',
  });

  return sig;
}

// Borsh encoding helpers
function encodeVecPublicKey(keys: PublicKey[]): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(keys.length, 0);
  return Buffer.concat([lenBuf, ...keys.map((k) => k.toBuffer())]);
}

function encodeVecU64(values: bigint[]): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(values.length, 0);
  const valueBufs = values.map((v) => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(v, 0);
    return buf;
  });
  return Buffer.concat([lenBuf, ...valueBufs]);
}

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

  const { tokenAddress } = event;

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

    // Derive PDAs
    const [factoryState] = deriveFactoryStatePDA(programId);

    // Fetch token state to get serverSlug and mint
    const tokenStatePubkey = new PublicKey(tokenAddress);
    const tokenStateInfo = await connection.getAccountInfo(tokenStatePubkey);
    if (!tokenStateInfo) {
      throw new Error(`Token state account not found: ${tokenAddress}`);
    }

    // Decode token state (Anchor discriminator + borsh)
    const data = tokenStateInfo.data;
    const offset = 8; // Skip Anchor discriminator

    // Read serverSlug (4-byte length + string)
    const slugLen = data.readUInt32LE(offset);
    const serverSlug = data.subarray(offset + 4, offset + 4 + slugLen).toString('utf8');

    // Read mint pubkey (after slug + name + symbol)
    let pos = offset + 4 + slugLen;
    const nameLen = data.readUInt32LE(pos);
    pos += 4 + nameLen;
    const symbolLen = data.readUInt32LE(pos);
    pos += 4 + symbolLen;
    const mint = new PublicKey(data.subarray(pos, pos + 32));

    console.log(`Token: serverSlug=${serverSlug}, mint=${mint.toBase58()}`);

    const [, tokenStateBump] = deriveTokenStatePDA(serverSlug, programId);
    const [mintAuthority] = deriveMintAuthorityPDA(tokenStatePubkey, programId);

    // Read factory state to get payment_token_mint
    const factoryInfo = await connection.getAccountInfo(factoryState);
    if (!factoryInfo) throw new Error('Factory state not found');
    // Skip discriminator(8) + admin(32) + automationWallet(32) = 72
    const paymentTokenMint = new PublicKey(factoryInfo.data.subarray(72, 104));

    // Fetch earnings data from backend
    if (!backendUrl) throw new Error('BACKEND_URL required for earnings fetch');
    const earnings = await fetchEarnings(backendUrl, tokenAddress, internalSecret);
    console.log(`Fetched ${earnings.length} earnings entries`);

    // Batch mint in chunks of MAX_BATCH_SIZE
    let lastSig = '';
    for (let i = 0; i < earnings.length; i += MAX_BATCH_SIZE) {
      const chunk = earnings.slice(i, i + MAX_BATCH_SIZE);
      const recipients = chunk.map((e) => new PublicKey(e.userAddress));
      const amounts = chunk.map((e) => BigInt(e.totalTokensEarned));
      const fees = chunk.map(() => BigInt(0));

      console.log(`Batch minting chunk ${Math.floor(i / MAX_BATCH_SIZE) + 1}: ${chunk.length} recipients`);

      lastSig = await batchMintChunk(
        connection,
        automationWallet,
        programId,
        factoryState,
        tokenStatePubkey,
        mint,
        mintAuthority,
        recipients,
        amounts,
        fees,
      );
      console.log(`Batch mint confirmed: ${lastSig}`);
    }

    // Now call deploy_liquidity
    console.log('Calling deploy_liquidity...');
    const graduationSig = await deployLiquidity(
      connection,
      automationWallet,
      programId,
      factoryState,
      tokenStatePubkey,
      mint,
      mintAuthority,
      paymentTokenMint,
    );
    console.log(`deploy_liquidity confirmed: ${graduationSig}`);

    // Confirm back to backend
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
          console.error(`Confirmation POST failed: ${response.status}`);
        } else {
          console.log(`Backend confirmation sent for ${tokenAddress}`);
        }
      } catch (confirmErr) {
        console.error('Failed to notify backend:', confirmErr);
      }
    }

    res.status(200).json({
      status: 'graduated',
      txHash: graduationSig,
      tokenAddress,
      batchesProcessed: Math.ceil(earnings.length / MAX_BATCH_SIZE),
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
