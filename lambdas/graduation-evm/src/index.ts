/**
 * EVM Graduation Lambda
 *
 * Receives graduation events from Cloud Tasks (via the backend's graduationNotifier)
 * and executes on-chain graduation via TokenDistributor.graduateTokenWithMerkle().
 *
 * After successful tx, POSTs back to /internal/graduation-confirm/:tokenAddress
 * so the backend sets graduated=true in Firestore.
 *
 * Environment variables:
 *   AUTOMATION_PRIVATE_KEY - Private key of the minter wallet
 *   RPC_URL               - EVM RPC endpoint (Base Sepolia, etc.)
 *   TOKEN_DISTRIBUTOR      - Address of the TokenDistributor contract
 *   BACKEND_URL            - Cloud Run service URL (e.g. https://apix-backend.run.app)
 *   GRADUATION_INTERNAL_SECRET - Shared secret for internal endpoints
 */

import { ethers } from 'ethers';

const TOKEN_DISTRIBUTOR_ABI = [
  'function graduateTokenWithMerkle(address token, bytes32 merkleRoot, uint256 virtualDistributed, uint256 actualFeesCollected) external',
];

interface GraduationEvent {
  action: string;
  tokenAddress: string;
  chainId: string;
  merkleRoot: string;
  virtualDistributed: string;
  totalFeesCollected: string;
}

interface LambdaResponse {
  statusCode: number;
  body: string;
}

export async function handler(event: GraduationEvent): Promise<LambdaResponse> {
  console.log('Graduation event received:', JSON.stringify(event));

  if (event.action !== 'graduate') {
    return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${event.action}` }) };
  }

  const { tokenAddress, merkleRoot, virtualDistributed, totalFeesCollected } = event;

  const privateKey = process.env.AUTOMATION_PRIVATE_KEY;
  const rpcUrl = process.env.RPC_URL;
  const distributorAddress = process.env.TOKEN_DISTRIBUTOR;
  const backendUrl = process.env.BACKEND_URL;
  const internalSecret = process.env.GRADUATION_INTERNAL_SECRET;

  if (!privateKey || !rpcUrl || !distributorAddress) {
    console.error('Missing required environment variables');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  try {
    // Connect to EVM
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const distributor = new ethers.Contract(distributorAddress, TOKEN_DISTRIBUTOR_ABI, wallet);

    console.log(`Calling graduateTokenWithMerkle(${tokenAddress}, ${merkleRoot}, ${virtualDistributed}, ${totalFeesCollected})`);

    // Execute on-chain graduation
    const tx = await distributor.graduateTokenWithMerkle(
      tokenAddress,
      merkleRoot,
      BigInt(virtualDistributed),
      BigInt(totalFeesCollected),
    );

    console.log(`TX submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`TX confirmed in block ${receipt.blockNumber}`);

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

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'graduated',
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        tokenAddress,
      }),
    };
  } catch (err: any) {
    console.error('Graduation TX failed:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Graduation TX failed',
        message: err.message,
        tokenAddress,
      }),
    };
  }
}
