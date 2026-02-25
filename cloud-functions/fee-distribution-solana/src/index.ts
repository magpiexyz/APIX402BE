/**
 * Solana Fee Distribution Cloud Function
 *
 * Receives fee distribution requests via HTTP POST and executes on-chain
 * fee distribution via the iao_factory.distribute_fees instruction.
 *
 * Called weekly by Cloud Scheduler to distribute accumulated fees to builders and team.
 *
 * This mirrors the EVM fee distribution cloud function flow:
 *   EVM:    TokenDistributor.distributeFees()
 *   Solana: iao_factory.distribute_fees()
 *
 * Environment variables:
 *   AUTOMATION_PRIVATE_KEY         - Base58-encoded private key of automation wallet
 *   SOLANA_RPC_URL                 - Solana RPC endpoint
 *   IAO_PROGRAM_ID                 - IAO Factory program ID (FpCX6E1LxRph23NJgF9R8haRJscGPbbdhP2vd5Sn6jwA)
 *   BACKEND_URL                    - Cloud Run service URL
 *   FEE_DISTRIBUTION_SECRET        - Shared secret for internal endpoints
 */

import { HttpFunction } from '@google-cloud/functions-framework';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';

interface FeeDistributionEvent {
  action: string;
  tokens: Array<{
    tokenAddress: string;
    pendingFees: string;
  }>;
}

function getProgramId(): PublicKey {
  return new PublicKey(process.env.IAO_PROGRAM_ID || 'FpCX6E1LxRph23NJgF9R8haRJscGPbbdhP2vd5Sn6jwA');
}

// --- PDA Derivation ---

function deriveFactoryStatePDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('factory')], programId);
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

// --- distribute_fees Instruction ---

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

export const distributeFeesSolana: HttpFunction = async (req, res) => {
  // Verify shared secret
  const expectedSecret = process.env.FEE_DISTRIBUTION_SECRET;
  if (expectedSecret) {
    const providedSecret = req.headers['x-fee-distribution-secret'];
    if (providedSecret !== expectedSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const event: FeeDistributionEvent = req.body;
  console.log('Solana fee distribution event received:', JSON.stringify(event));

  if (event.action !== 'distribute-fees') {
    res.status(400).json({ error: `Unknown action: ${event.action}` });
    return;
  }

  const { tokens } = event;

  if (!tokens || tokens.length === 0) {
    res.status(400).json({ error: 'No tokens provided' });
    return;
  }

  const privateKey = process.env.AUTOMATION_PRIVATE_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const backendUrl = process.env.BACKEND_URL;
  const internalSecret = process.env.FEE_DISTRIBUTION_SECRET;

  if (!privateKey || !rpcUrl) {
    console.error('Missing required environment variables');
    res.status(500).json({ error: 'Missing env vars' });
    return;
  }

  // Filter tokens with non-zero pending fees
  const tokensToProcess = tokens.filter(t => BigInt(t.pendingFees || '0') > 0n);

  if (tokensToProcess.length === 0) {
    res.status(200).json({
      status: 'skipped',
      message: 'No tokens with pending fees',
    });
    return;
  }

  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const automationWallet = Keypair.fromSecretKey(bs58.decode(privateKey));
    const programId = getProgramId();

    // Derive shared PDAs
    const [factoryState] = deriveFactoryStatePDA(programId);
    const [feeConfig] = deriveFeeConfigPDA(programId);

    // Fetch fee config for team/buyback addresses
    const feeConfigInfo = await connection.getAccountInfo(feeConfig);
    if (!feeConfigInfo) {
      throw new Error('FeeConfig account not found');
    }
    const { teamAddress, buybackAddress } = decodeFeeConfig(feeConfigInfo.data);

    // Fetch payment token mint from factory state
    const factoryInfo = await connection.getAccountInfo(factoryState);
    if (!factoryInfo) throw new Error('Factory state not found');
    const paymentTokenMint = new PublicKey(factoryInfo.data.subarray(72, 104));

    // Derive team and buyback USDC ATAs (shared across all tokens)
    const teamUsdcAccount = await getAssociatedTokenAddress(paymentTokenMint, teamAddress);
    const buybackUsdcAccount = await getAssociatedTokenAddress(paymentTokenMint, buybackAddress);

    console.log(`Distributing fees for ${tokensToProcess.length} tokens:`);
    tokensToProcess.forEach(t => {
      console.log(`  - ${t.tokenAddress}: ${t.pendingFees}`);
    });

    // Process each token individually (Solana's distribute_fees is per-token)
    const results: Array<{ tokenAddress: string; txHash: string }> = [];
    const failures: Array<{ tokenAddress: string; error: string }> = [];

    for (const tokenEntry of tokensToProcess) {
      try {
        const tokenStatePubkey = new PublicKey(tokenEntry.tokenAddress);

        // Fetch token state to get builder address
        const tokenStateInfo = await connection.getAccountInfo(tokenStatePubkey);
        if (!tokenStateInfo) {
          throw new Error(`Token state account not found: ${tokenEntry.tokenAddress}`);
        }
        const { builder } = decodeTokenState(tokenStateInfo.data);

        // Derive per-token PDAs
        const [vault] = deriveVaultPDA(tokenStatePubkey, programId);
        const [vaultAuthority] = deriveVaultAuthorityPDA(tokenStatePubkey, programId);
        const builderUsdcAccount = await getAssociatedTokenAddress(paymentTokenMint, builder);

        const sig = await callDistributeFees(
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

        console.log(`Fee distribution confirmed for ${tokenEntry.tokenAddress}: ${sig}`);
        results.push({ tokenAddress: tokenEntry.tokenAddress, txHash: sig });
      } catch (tokenErr: any) {
        console.error(`Fee distribution failed for ${tokenEntry.tokenAddress}: ${tokenErr.message}`);
        failures.push({ tokenAddress: tokenEntry.tokenAddress, error: tokenErr.message });
      }
    }

    // Notify backend of successful distributions
    if (backendUrl && results.length > 0) {
      try {
        const confirmUrl = `${backendUrl}/internal/fee-distribution-confirm`;
        const response = await fetch(confirmUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(internalSecret ? { 'X-Fee-Distribution-Secret': internalSecret } : {}),
          },
          body: JSON.stringify({
            txHash: results[results.length - 1].txHash, // Last successful tx
            tokens: results.map(r => r.tokenAddress),
            timestamp: new Date().toISOString(),
          }),
        });

        if (!response.ok) {
          console.error(`Confirmation POST failed: ${response.status} ${response.statusText}`);
        } else {
          console.log('Backend confirmation sent');
        }
      } catch (confirmErr) {
        console.error('Failed to notify backend (distribution txs already succeeded):', confirmErr);
      }
    }

    res.status(200).json({
      status: 'distributed',
      tokensProcessed: results.length,
      tokensFailed: failures.length,
      results,
      failures: failures.length > 0 ? failures : undefined,
    });
  } catch (err: any) {
    console.error('Solana fee distribution failed:', err);
    res.status(500).json({
      error: 'Fee distribution failed',
      message: err.message,
    });
  }
};
