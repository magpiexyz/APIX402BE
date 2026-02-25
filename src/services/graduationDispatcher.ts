/**
 * Graduation Dispatcher — Cloud Tasks
 *
 * Creates a named Cloud Task to trigger graduation processing.
 * Named tasks provide built-in deduplication (ALREADY_EXISTS is silently ignored).
 * Layer 2 of race condition protection.
 */

import { CloudTasksClient } from '@google-cloud/tasks';

let tasksClient: CloudTasksClient | null = null;

function getTasksClient(): CloudTasksClient {
  if (!tasksClient) {
    tasksClient = new CloudTasksClient();
  }
  return tasksClient;
}

export interface GraduationTaskPayload {
  tokenAddress: string;
  chainId: string;
  virtualDistributed: string;
  totalFeesCollected: string;
}

/**
 * Dispatch a graduation task to Cloud Tasks.
 * Uses a named task (graduate-{tokenAddress}) so duplicate dispatches are rejected.
 */
export async function dispatchGraduationTask(payload: GraduationTaskPayload): Promise<void> {
  const queueName = process.env.GRADUATION_QUEUE_NAME || 'graduation-queue';
  const queueLocation = process.env.GRADUATION_QUEUE_LOCATION || 'us-central1';
  const projectId = process.env.GCP_PROJECT_ID;
  const serviceUrl = process.env.CLOUD_RUN_SERVICE_URL;
  const internalSecret = process.env.GRADUATION_INTERNAL_SECRET;

  if (!projectId || !serviceUrl) {
    console.error('❌ Missing GCP_PROJECT_ID or CLOUD_RUN_SERVICE_URL for graduation dispatch');
    return;
  }

  const client = getTasksClient();
  const parent = client.queuePath(projectId, queueLocation, queueName);
  const taskName = `${parent}/tasks/graduate-${payload.tokenAddress.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;

  const url = `${serviceUrl}/internal/graduate/${payload.tokenAddress}`;

  try {
    await client.createTask({
      parent,
      task: {
        name: taskName,
        httpRequest: {
          httpMethod: 'POST',
          url,
          headers: {
            'Content-Type': 'application/json',
            ...(internalSecret ? { 'X-Graduation-Secret': internalSecret } : {}),
          },
          body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
        // Schedule immediately
        scheduleTime: {
          seconds: Math.floor(Date.now() / 1000),
        },
      },
    });

    console.log(`✅ Graduation task dispatched for ${payload.tokenAddress}`);
  } catch (err: any) {
    // gRPC code 6 = ALREADY_EXISTS — task with this name already queued (dedup working)
    if (err.code === 6) {
      console.log(`⏳ Graduation task already exists for ${payload.tokenAddress} (dedup)`);
      return;
    }
    console.error(`❌ Failed to dispatch graduation task for ${payload.tokenAddress}:`, err);
    throw err;
  }
}
