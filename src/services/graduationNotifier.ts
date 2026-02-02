/**
 * Graduation Notifier — HTTP Cloud Function Invocation
 *
 * Invokes the appropriate GCP Cloud Function (EVM or Solana) to execute
 * the on-chain graduation transaction via HTTP POST.
 *
 * The Cloud Function holds the AUTOMATION_PRIVATE_KEY — the backend never touches private keys.
 */

export interface GraduationNotification {
  tokenAddress: string;
  chainId: string;
  merkleRoot: string;
  virtualDistributed: string;
  totalFeesCollected: string;
}

/**
 * Determine which Cloud Function URL to use based on chainId.
 * EVM chains use numeric chainIds, Solana uses "devnet"/"mainnet-beta".
 */
function getCloudFunctionUrl(chainId: string): string | null {
  const solanaChains = ['devnet', 'mainnet-beta', 'testnet'];

  if (solanaChains.includes(chainId)) {
    return process.env.GRADUATION_FUNCTION_SOLANA_URL || null;
  }
  // Numeric chainId = EVM
  return process.env.GRADUATION_FUNCTION_EVM_URL || null;
}

/**
 * Invoke the Cloud Function for on-chain graduation via HTTP POST.
 */
export async function notifyForGraduation(notification: GraduationNotification): Promise<void> {
  const cloudFunctionUrl = getCloudFunctionUrl(notification.chainId);

  if (!cloudFunctionUrl) {
    console.error(`❌ No Cloud Function configured for chainId ${notification.chainId}`);
    throw new Error(`No graduation Cloud Function configured for chain ${notification.chainId}`);
  }

  const secret = process.env.GRADUATION_INTERNAL_SECRET;

  try {
    const response = await fetch(cloudFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Graduation-Secret': secret } : {}),
      },
      body: JSON.stringify({
        action: 'graduate',
        ...notification,
      }),
    });

    if (response.ok) {
      console.log(`✅ Cloud Function invoked for graduation: ${cloudFunctionUrl} (token: ${notification.tokenAddress})`);
    } else {
      console.warn(`⚠️  Unexpected Cloud Function status: ${response.status} for ${notification.tokenAddress}`);
    }
  } catch (err) {
    console.error(`❌ Failed to invoke Cloud Function ${cloudFunctionUrl} for ${notification.tokenAddress}:`, err);
    throw err;
  }
}
