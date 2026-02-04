/**
 * EVM Fee Distribution Cloud Function
 *
 * Receives fee distribution requests via HTTP POST and executes on-chain
 * fee distribution via TokenDistributor.distributeFees().
 *
 * Called weekly by Cloud Scheduler to distribute accumulated fees to builders and team.
 *
 * Environment variables:
 *   AUTOMATION_PRIVATE_KEY         - Private key of the minter wallet
 *   RPC_URL                        - EVM RPC endpoint (Base Sepolia, etc.)
 *   TOKEN_DISTRIBUTOR              - Address of the TokenDistributor contract
 *   BACKEND_URL                    - Cloud Run service URL (e.g. https://apix-backend.run.app)
 *   FEE_DISTRIBUTION_SECRET        - Shared secret for internal endpoints
 */

import { HttpFunction } from '@google-cloud/functions-framework';
import { ethers } from 'ethers';

const TOKEN_DISTRIBUTOR_ABI = [
  'function distributeFees(address[] tokens, uint256[] feeAmounts) external',
];

interface FeeDistributionEvent {
  action: string;
  tokens: Array<{
    tokenAddress: string;
    pendingFees: string;
  }>;
}

export const distributeFeesEvm: HttpFunction = async (req, res) => {
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
  console.log('Fee distribution event received:', JSON.stringify(event));

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
  const rpcUrl = process.env.RPC_URL;
  const distributorAddress = process.env.TOKEN_DISTRIBUTOR;
  const backendUrl = process.env.BACKEND_URL;
  const internalSecret = process.env.FEE_DISTRIBUTION_SECRET;

  if (!privateKey || !rpcUrl || !distributorAddress) {
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
    // Connect to EVM
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const distributor = new ethers.Contract(distributorAddress, TOKEN_DISTRIBUTOR_ABI, wallet);

    const tokenAddresses = tokensToProcess.map(t => t.tokenAddress);
    const feeAmounts = tokensToProcess.map(t => BigInt(t.pendingFees));

    console.log(`Distributing fees for ${tokensToProcess.length} tokens:`);
    tokensToProcess.forEach(t => {
      console.log(`  - ${t.tokenAddress}: ${t.pendingFees}`);
    });

    // Execute on-chain fee distribution
    const tx = await distributor.distributeFees(
      tokenAddresses,
      feeAmounts,
      { gasLimit: 500_000 * tokensToProcess.length }, // ~500k per token
    );

    console.log(`TX submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`TX confirmed in block ${receipt.blockNumber}`);

    // Notify backend of successful distribution
    if (backendUrl) {
      try {
        const confirmUrl = `${backendUrl}/internal/fee-distribution-confirm`;
        const response = await fetch(confirmUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(internalSecret ? { 'X-Fee-Distribution-Secret': internalSecret } : {}),
          },
          body: JSON.stringify({
            txHash: tx.hash,
            tokens: tokenAddresses,
            timestamp: new Date().toISOString(),
          }),
        });

        if (!response.ok) {
          console.error(`Confirmation POST failed: ${response.status} ${response.statusText}`);
        } else {
          console.log('Backend confirmation sent');
        }
      } catch (confirmErr) {
        console.error('Failed to notify backend (distribution tx already succeeded):', confirmErr);
      }
    }

    res.status(200).json({
      status: 'distributed',
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      tokensProcessed: tokenAddresses.length,
    });
  } catch (err: any) {
    console.error('Fee distribution TX failed:', err);
    res.status(500).json({
      error: 'Fee distribution TX failed',
      message: err.message,
    });
  }
};
