/**
 * DynamoDB-backed Cache Service
 * Following the ecoAPI pattern (/home/error0180/ecoAPI/src/utils/cache2.ts)
 *
 * Features:
 * - Persistent cache (survives Lambda cold starts and server restarts)
 * - Shared cache across all instances
 * - Environment-aware keys (dev_ prefix for non-production)
 * - Graceful degradation (returns stale data with isExpired flag)
 * - TTL-based expiration with DynamoDB auto-cleanup
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import dayjs from "dayjs";

// Configuration
const CACHE_TABLE_NAME = process.env.CACHE_TABLE_NAME || 'apix-cache';
const DYNAMODB_REGION = process.env.DYNAMODB_REGION || 'us-west-1';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// DynamoDB client singleton
let ddbDocClient: DynamoDBDocumentClient | null = null;

function getDdbDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const config: { region: string; endpoint?: string; credentials?: any } = {
      region: DYNAMODB_REGION,
    };

    // Use explicit credentials if provided
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
      };
    }

    // Use local endpoint if provided
    if (process.env.DYNAMODB_ENDPOINT) {
      config.endpoint = process.env.DYNAMODB_ENDPOINT;
    }

    const client = new DynamoDBClient(config);
    ddbDocClient = DynamoDBDocumentClient.from(client);
  }
  return ddbDocClient;
}

/**
 * Cache entry stored in DynamoDB
 */
interface CacheEntry {
  id: string;           // Cache key (with dev_ prefix for non-production)
  data: string;         // JSON stringified cache data
  dataTime: number;     // Unix timestamp of write
  ttl: number;          // Unix timestamp for DynamoDB TTL auto-cleanup
}

/**
 * Internal cache data structure
 */
interface CacheData<T> {
  data: T;
  putTimestamp: number;          // Timestamp in milliseconds
  formatPutTimestamp: string;    // Human-readable timestamp
  duration: number;              // TTL in milliseconds, -1 = never expire
}

/**
 * Cache result returned by getCached()
 */
export interface CacheResult<T> {
  isExpired: boolean;   // Whether the cache entry has expired
  data: T;              // Cached data (may be stale if isExpired)
  maxAge?: number;      // Remaining TTL in seconds (if not expired)
}

/**
 * Predefined cache key generators for common use cases
 */
export const CacheKeys = {
  SERVER_BY_SLUG: (slug: string) => `server:${slug.toLowerCase()}`,
  SERVER_BY_ID: (tokenAddress: string) => `server:id:${tokenAddress.toLowerCase()}`,
  METRICS: (tokenAddress: string) => `metrics:${tokenAddress.toLowerCase()}`,
  CONTRACT_STATE: (tokenAddress: string) => `contract:${tokenAddress.toLowerCase()}`,
  ALL_SERVERS: () => 'servers:all',
  SERVERS_BY_CHAIN: (chainId: string) => `servers:chain:${chainId}`,
};

/**
 * Default TTL values in milliseconds
 */
export const CacheTTL = {
  SHORT: 1 * 60 * 1000,       // 1 minute
  MEDIUM: 5 * 60 * 1000,      // 5 minutes (default)
  LONG: 10 * 60 * 1000,       // 10 minutes
  HOUR: 60 * 60 * 1000,       // 1 hour
  NEVER: -1,                  // Never expire
};

/**
 * Get environment-aware cache key
 * Adds dev_ prefix for non-production environments to prevent pollution
 */
function getCacheKey(key: string): string {
  return IS_PRODUCTION ? key : `dev_${key}`;
}

/**
 * Store value in cache with optional TTL
 * @param key - Cache key
 * @param value - Value to cache
 * @param durationMs - TTL in milliseconds (default: 5 minutes)
 */
export async function setCached<T>(
  key: string,
  value: T,
  durationMs: number = CacheTTL.MEDIUM
): Promise<void> {
  try {
    const cacheKey = getCacheKey(key);
    const date = new Date();
    const currentTime = Math.round(date.getTime() / 1000);

    const cacheData: CacheData<T> = {
      data: value,
      putTimestamp: date.getTime(),
      formatPutTimestamp: dayjs(date).format("YYYY-MM-DD HH:mm:ss:SSS"),
      duration: durationMs,
    };

    const cacheEntry: CacheEntry = {
      id: cacheKey,
      data: JSON.stringify(cacheData),
      dataTime: currentTime,
      // Set DynamoDB TTL to 100 years (practically never auto-delete)
      // We handle expiration manually in getCached()
      ttl: currentTime + (100 * 365 * 24 * 60 * 60),
    };

    await getDdbDocClient().send(new PutCommand({
      TableName: CACHE_TABLE_NAME,
      Item: cacheEntry,
    }));

    console.log(`📦 Cache SET: ${key} (TTL: ${durationMs}ms)`);
  } catch (error) {
    console.error(`❌ setCacheError|${key}|${error}`);
    // Don't throw - cache failures shouldn't break the application
  }
}

/**
 * Get value from cache
 * Returns { isExpired, data, maxAge } or undefined if not found
 *
 * @param key - Cache key
 * @returns Cache result with expiration status, or undefined if not found
 */
export async function getCached<T>(key: string): Promise<CacheResult<T> | undefined> {
  try {
    const cacheKey = getCacheKey(key);
    const result = await getDdbDocClient().send(new GetCommand({
      TableName: CACHE_TABLE_NAME,
      Key: { id: cacheKey },
    }));

    if (!result.Item) {
      console.log(`📦 Cache MISS: ${key}`);
      return undefined;
    }

    const cacheData: CacheData<T> = JSON.parse(result.Item.data);
    const currentTimestamp = Date.now();

    // Duration -1 means never expire
    if (cacheData.duration === -1) {
      console.log(`📦 Cache HIT: ${key} (never expires)`);
      return { isExpired: false, data: cacheData.data };
    }

    // Check if expired
    const expiresAt = cacheData.putTimestamp + cacheData.duration;
    if (expiresAt < currentTimestamp) {
      console.log(`📦 Cache STALE: ${key} (expired ${Math.round((currentTimestamp - expiresAt) / 1000)}s ago)`);
      return { isExpired: true, data: cacheData.data };
    }

    // Calculate remaining TTL in seconds
    const maxAge = Math.floor((expiresAt - currentTimestamp) / 1000);
    console.log(`📦 Cache HIT: ${key} (expires in ${maxAge}s)`);
    return { isExpired: false, data: cacheData.data, maxAge };
  } catch (error) {
    console.error(`❌ getCacheError|${key}|${error}`);
    return undefined;
  }
}

/**
 * Delete cache entry
 * @param key - Cache key to delete
 */
export async function invalidateCache(key: string): Promise<void> {
  try {
    const cacheKey = getCacheKey(key);
    await getDdbDocClient().send(new DeleteCommand({
      TableName: CACHE_TABLE_NAME,
      Key: { id: cacheKey },
    }));
    console.log(`📦 Cache DELETE: ${key}`);
  } catch (error) {
    console.error(`❌ deleteCacheError|${key}|${error}`);
    // Don't throw - cache failures shouldn't break the application
  }
}

/**
 * Invalidate all cache entries matching a prefix
 * Note: This is expensive as it requires scanning. Use sparingly.
 * @param prefix - Key prefix to match (e.g., "server:" to invalidate all server caches)
 */
export async function invalidateCacheByPrefix(prefix: string): Promise<void> {
  // For DynamoDB, this would require a Scan operation which is expensive
  // In production, you might want to maintain a separate index of keys
  // For now, we log a warning
  console.warn(`⚠️ invalidateCacheByPrefix not fully implemented for DynamoDB. Prefix: ${prefix}`);
}

/**
 * Helper function to get cached value or fetch fresh data
 * Implements cache-aside pattern with stale-while-revalidate behavior
 *
 * @param key - Cache key
 * @param fetchFn - Function to fetch fresh data if cache miss/expired
 * @param ttlMs - TTL in milliseconds
 * @param useStaleOnError - Whether to use stale data if fetch fails (default: true)
 */
export async function getOrSet<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlMs: number = CacheTTL.MEDIUM,
  useStaleOnError: boolean = true
): Promise<T> {
  // Check cache first
  const cacheResult = await getCached<T>(key);

  // Cache hit and not expired - return immediately
  if (cacheResult && !cacheResult.isExpired) {
    return cacheResult.data;
  }

  // Cache miss or expired - fetch fresh data
  try {
    const freshData = await fetchFn();

    // Update cache with fresh data
    await setCached(key, freshData, ttlMs);

    return freshData;
  } catch (error) {
    // If fetch fails but we have stale data, return it
    if (useStaleOnError && cacheResult?.data) {
      console.warn(`⚠️ Fetch failed, returning stale cache for: ${key}`);
      return cacheResult.data;
    }

    // No stale data available, re-throw the error
    throw error;
  }
}
