/**
 * EVM Graduation Cloud Function
 *
 * Receives graduation events via HTTP POST and executes on-chain graduation
 * via TokenDistributor.graduateTokenWithMerkle().
 *
 * After successful tx, POSTs back to /internal/graduation-confirm/:tokenAddress
 * so the backend sets graduated=true in Firestore.
 *
 * Environment variables:
 *   AUTOMATION_PRIVATE_KEY         - Private key of the minter wallet
 *   RPC_URL                        - EVM RPC endpoint (Base Sepolia, etc.)
 *   TOKEN_DISTRIBUTOR              - Address of the TokenDistributor contract
 *   BACKEND_URL                    - Cloud Run service URL (e.g. https://apix-backend.run.app)
 *   GRADUATION_INTERNAL_SECRET     - Shared secret for internal endpoints
 */

import { HttpFunction } from '@google-cloud/functions-framework';
import { ethers } from 'ethers';

const TOKEN_DISTRIBUTOR_ABI = [
  'function graduateTokenWithMerkle(address token, bytes32 merkleRoot, uint256 virtualDistributed, uint256 actualFeesCollected) external',
  'function distributeFees(address[] tokens, uint256[] feeAmounts) external',
];

interface GraduationEvent {
  action: string;
  tokenAddress: string;
  chainId: string;
  merkleRoot: string;
  virtualDistributed: string;
  totalFeesCollected: string;
}

export const graduateEvm: HttpFunction = async (req, res) => {
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
  console.log('Graduation event received:', JSON.stringify(event));

  if (event.action !== 'graduate') {
    res.status(400).json({ error: `Unknown action: ${event.action}` });
    return;
  }

  const { tokenAddress, merkleRoot, virtualDistributed, totalFeesCollected } = event;

  const privateKey = process.env.AUTOMATION_PRIVATE_KEY;
  const rpcUrl = process.env.RPC_URL;
  const distributorAddress = process.env.TOKEN_DISTRIBUTOR;
  const backendUrl = process.env.BACKEND_URL;
  const internalSecret = process.env.GRADUATION_INTERNAL_SECRET;

  if (!privateKey || !rpcUrl || !distributorAddress) {
    console.error('Missing required environment variables');
    res.status(500).json({ error: 'Missing env vars' });
    return;
  }

  try {
    // Connect to EVM
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const distributor = new ethers.Contract(distributorAddress, TOKEN_DISTRIBUTOR_ABI, wallet);

    console.log(`Calling graduateTokenWithMerkle(${tokenAddress}, ${merkleRoot}, ${virtualDistributed}, ${totalFeesCollected})`);

    // Execute on-chain graduation
    // Note: Uniswap V4 pool initialization requires ~20M gas
    const tx = await distributor.graduateTokenWithMerkle(
      tokenAddress,
      merkleRoot,
      BigInt(virtualDistributed),
      BigInt(totalFeesCollected),
      { gasLimit: 25_000_000 },
    );

    console.log(`TX submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`TX confirmed in block ${receipt.blockNumber}`);

    // Distribute fees after graduation (split between builder and team)
    // Note: Use pre-graduation fee amounts since this is the transition moment
    // The fees collected during bonding curve need to be distributed
    try {
      const feesToDistribute = BigInt(totalFeesCollected);
      if (feesToDistribute > 0n) {
        console.log(`Distributing fees: ${feesToDistribute.toString()} for token ${tokenAddress}`);
        const feeTx = await distributor.distributeFees(
          [tokenAddress],
          [feesToDistribute],
          { gasLimit: 500_000 },
        );
        console.log(`Fee distribution TX submitted: ${feeTx.hash}`);
        const feeReceipt = await feeTx.wait();
        console.log(`Fee distribution confirmed in block ${feeReceipt.blockNumber}`);
      } else {
        console.log('No fees to distribute');
      }
    } catch (feeErr: any) {
      // Log but don't fail the graduation - fees can be distributed later
      console.error(`Fee distribution failed (graduation succeeded): ${feeErr.message}`);
    }

    // Notify backend of successful graduation
    if (backendUrl) {
      try {
        const confirmUrl = `${backendUrl}/internal/graduation-confirm/${tokenAddress}`;
        const response = await fetch(confirmUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(internalSecret ? { 'X-Graduation-Secret': internalSecret } : {}),
          },
          body: JSON.stringify({ txHash: tx.hash }),
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
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      tokenAddress,
    });
  } catch (err: any) {
    console.error('Graduation TX failed:', err);
    res.status(500).json({
      error: 'Graduation TX failed',
      message: err.message,
      tokenAddress,
    });
  }
};
