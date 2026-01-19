/**
 * DynamoDB-based Rate Limiting Service
 *
 * Provides distributed rate limiting that works across multiple server instances.
 * Uses atomic counters with TTL for automatic cleanup.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

// Configuration
const TABLE_NAME = process.env.RATE_LIMIT_TABLE_NAME || 'apix-rate-limits';
const DYNAMODB_REGION = process.env.DYNAMODB_REGION || 'us-west-1';

// Rate limit configuration (can be overridden via env vars)
export const RATE_LIMITS = {
  global: {
    windowMs: parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX || '1000'),
  },
  ip: {
    windowMs: parseInt(process.env.RATE_LIMIT_IP_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_IP_MAX || '100'),
  },
  wallet: {
    windowMs: parseInt(process.env.RATE_LIMIT_WALLET_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_WALLET_MAX || '50'),
  },
  api: {
    windowMs: parseInt(process.env.RATE_LIMIT_API_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_API_MAX || '200'),
  },
};

// DynamoDB client singleton
let ddbDocClient: DynamoDBDocumentClient | null = null;

function getDdbDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const config: { region: string; endpoint?: string; credentials?: any } = {
      region: DYNAMODB_REGION,
    };

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
      };
    }

    if (process.env.DYNAMODB_ENDPOINT) {
      config.endpoint = process.env.DYNAMODB_ENDPOINT;
    }

    const client = new DynamoDBClient(config);
    ddbDocClient = DynamoDBDocumentClient.from(client);
  }
  return ddbDocClient;
}

/**
 * Rate limit entry stored in DynamoDB
 */
interface RateLimitEntry {
  id: string;           // Partition key (e.g., "ip:1.2.3.4", "wallet:0xabc")
  count: number;        // Current request count in window
  windowStart: number;  // Timestamp when window started (ms)
  ttl: number;          // TTL for auto-deletion (seconds)
}

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  allowed: boolean;     // Whether request is allowed
  current: number;      // Current count in window
  limit: number;        // Maximum allowed
  remaining: number;    // Remaining requests in window
  resetAt: number;      // When window resets (timestamp ms)
  retryAfter?: number;  // Seconds until retry (if blocked)
}

/**
 * Check and update rate limit for a given key
 * Uses atomic increment to prevent race conditions
 */
export async function checkRateLimit(
  key: string,
  limitType: 'global' | 'ip' | 'wallet' | 'api'
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[limitType];
  const now = Date.now();
  const windowMs = config.windowMs;
  const maxRequests = config.max;

  try {
    // Get current entry
    const getResult = await getDdbDocClient().send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: key },
      })
    );

    const entry = getResult.Item as RateLimitEntry | undefined;
    const windowStart = entry?.windowStart || 0;
    const currentCount = entry?.count || 0;

    // Check if we're in a new window
    const windowExpired = (now - windowStart) >= windowMs;

    if (windowExpired) {
      // Start new window with count = 1
      const newWindowStart = now;
      const ttlSeconds = Math.floor((now + windowMs * 2) / 1000); // TTL = 2x window for safety

      await getDdbDocClient().send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { id: key },
          UpdateExpression: 'SET #count = :one, windowStart = :start, #ttl = :ttl',
          ExpressionAttributeNames: {
            '#count': 'count',
            '#ttl': 'ttl',
          },
          ExpressionAttributeValues: {
            ':one': 1,
            ':start': newWindowStart,
            ':ttl': ttlSeconds,
          },
        })
      );

      return {
        allowed: true,
        current: 1,
        limit: maxRequests,
        remaining: maxRequests - 1,
        resetAt: newWindowStart + windowMs,
      };
    }

    // Same window - check if limit exceeded
    if (currentCount >= maxRequests) {
      const resetAt = windowStart + windowMs;
      const retryAfter = Math.ceil((resetAt - now) / 1000);

      return {
        allowed: false,
        current: currentCount,
        limit: maxRequests,
        remaining: 0,
        resetAt,
        retryAfter: Math.max(1, retryAfter),
      };
    }

    // Increment counter atomically
    const updateResult = await getDdbDocClient().send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: key },
        UpdateExpression: 'SET #count = #count + :inc',
        ExpressionAttributeNames: {
          '#count': 'count',
        },
        ExpressionAttributeValues: {
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    const newCount = (updateResult.Attributes as RateLimitEntry)?.count || currentCount + 1;

    return {
      allowed: newCount <= maxRequests,
      current: newCount,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - newCount),
      resetAt: windowStart + windowMs,
    };

  } catch (error: any) {
    // If table doesn't exist or other error, allow request but log warning
    if (error.name === 'ResourceNotFoundException') {
      console.warn(`⚠️ Rate limit table "${TABLE_NAME}" not found. Rate limiting disabled.`);
    } else {
      console.error(`❌ Rate limit check failed for ${key}:`, error.message);
    }

    // Fail open - allow request if rate limiting fails
    return {
      allowed: true,
      current: 0,
      limit: maxRequests,
      remaining: maxRequests,
      resetAt: now + windowMs,
    };
  }
}

/**
 * Generate rate limit key for IP
 */
export function getIpKey(ip: string): string {
  return `ip:${ip}`;
}

/**
 * Generate rate limit key for wallet
 */
export function getWalletKey(wallet: string): string {
  return `wallet:${wallet.toLowerCase()}`;
}

/**
 * Generate rate limit key for API endpoint
 */
export function getApiKey(serverSlug: string, apiSlug: string): string {
  return `api:${serverSlug.toLowerCase()}:${apiSlug.toLowerCase()}`;
}

/**
 * Generate rate limit key for global limit
 */
export function getGlobalKey(): string {
  return 'global';
}

/**
 * Check multiple rate limits at once
 * Returns the most restrictive result
 */
export async function checkMultipleRateLimits(
  checks: Array<{ key: string; type: 'global' | 'ip' | 'wallet' | 'api' }>
): Promise<{ allowed: boolean; result: RateLimitResult; failedType?: string }> {
  for (const check of checks) {
    const result = await checkRateLimit(check.key, check.type);
    if (!result.allowed) {
      return { allowed: false, result, failedType: check.type };
    }
  }

  // All passed - return last result
  const lastCheck = checks[checks.length - 1];
  const result = await checkRateLimit(lastCheck.key, lastCheck.type);
  return { allowed: true, result };
}

/**
 * Get current rate limit status without incrementing
 */
export async function getRateLimitStatus(key: string): Promise<RateLimitEntry | null> {
  try {
    const result = await getDdbDocClient().send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: key },
      })
    );
    return (result.Item as RateLimitEntry) || null;
  } catch (error) {
    console.error(`❌ Failed to get rate limit status for ${key}:`, error);
    return null;
  }
}

export default {
  checkRateLimit,
  checkMultipleRateLimits,
  getRateLimitStatus,
  getIpKey,
  getWalletKey,
  getApiKey,
  getGlobalKey,
  RATE_LIMITS,
};
