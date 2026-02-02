/**
 * Graduation Notifier — Direct Lambda Invocation
 *
 * Invokes the appropriate AWS Lambda (EVM or Solana) to execute
 * the on-chain graduation transaction. Uses async invocation
 * (InvocationType: Event) so the backend doesn't wait for completion.
 *
 * The Lambda holds the AUTOMATION_PRIVATE_KEY — the backend never touches private keys.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

let lambdaClient: LambdaClient | null = null;

function getLambdaClient(): LambdaClient {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return lambdaClient;
}

export interface GraduationNotification {
  tokenAddress: string;
  chainId: string;
  merkleRoot: string;
  virtualDistributed: string;
  totalFeesCollected: string;
}

/**
 * Determine which Lambda function to invoke based on chainId.
 * EVM chains use numeric chainIds, Solana uses "devnet"/"mainnet-beta".
 */
function getLambdaFunctionName(chainId: string): string | null {
  const solanaChains = ['devnet', 'mainnet-beta', 'testnet'];

  if (solanaChains.includes(chainId)) {
    return process.env.GRADUATION_LAMBDA_SOLANA || null;
  }
  // Numeric chainId = EVM
  return process.env.GRADUATION_LAMBDA_EVM || null;
}

/**
 * Invoke the Lambda for on-chain graduation.
 * Uses InvocationType: Event for async fire-and-forget with AWS-managed retries.
 */
export async function notifyLambdaForGraduation(notification: GraduationNotification): Promise<void> {
  const functionName = getLambdaFunctionName(notification.chainId);

  if (!functionName) {
    console.error(`❌ No Lambda function configured for chainId ${notification.chainId}`);
    throw new Error(`No graduation Lambda configured for chain ${notification.chainId}`);
  }

  const client = getLambdaClient();

  try {
    const command = new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event', // Async — fire-and-forget with retries
      Payload: JSON.stringify({
        action: 'graduate',
        ...notification,
      }),
    });

    const response = await client.send(command);

    // StatusCode 202 = accepted for async invocation
    if (response.StatusCode === 202) {
      console.log(`✅ Lambda invoked for graduation: ${functionName} (token: ${notification.tokenAddress})`);
    } else {
      console.warn(`⚠️  Unexpected Lambda status code: ${response.StatusCode} for ${notification.tokenAddress}`);
    }
  } catch (err) {
    console.error(`❌ Failed to invoke Lambda ${functionName} for ${notification.tokenAddress}:`, err);
    throw err;
  }
}
