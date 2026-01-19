import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

let dynamoDBClient: DynamoDBClient | null = null;
let dynamoDBDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDBClient(region: string): DynamoDBClient {
  if (!dynamoDBClient) {
    // Connect to deployed AWS DynamoDB instance by default
    // AWS SDK v3 uses the default credential chain in this order:
    // 1. Explicit credentials passed to the client (via credentials option)
    // 2. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN)
    // 3. AWS credentials file (~/.aws/credentials)
    // 4. IAM roles (if running on EC2, Lambda, ECS, etc.)
    // 
    // For Vercel deployment, set these environment variables:
    // - AWS_ACCESS_KEY_ID
    // - AWS_SECRET_ACCESS_KEY
    // - AWS_REGION (or use DYNAMODB_REGION)
    //
    // For local testing, set DYNAMODB_ENDPOINT environment variable (e.g., http://localhost:8000)
    const config: { 
      region: string; 
      endpoint?: string;
      credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
      };
    } = {
      region,
    };
    
    // Explicitly set credentials if provided via environment variables
    // This is optional - if not set, AWS SDK will use the default credential chain
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
      };
      console.log(`🔑 Using explicit AWS credentials from environment variables`);
    } else {
      console.log(`🔍 Using AWS SDK default credential chain (env vars, credentials file, or IAM role)`);
    }
    
    // Only set endpoint if explicitly provided for local testing
    if (process.env.DYNAMODB_ENDPOINT) {
      config.endpoint = process.env.DYNAMODB_ENDPOINT;
      console.log(`🔧 Using local DynamoDB endpoint: ${config.endpoint}`);
    } else {
      console.log(`🌐 Connecting to deployed AWS DynamoDB in region: ${region}`);
    }
    
    dynamoDBClient = new DynamoDBClient(config);
  }
  return dynamoDBClient;
}

function getDynamoDBDocClient(region: string): DynamoDBDocumentClient {
  if (!dynamoDBDocClient) {
    dynamoDBDocClient = DynamoDBDocumentClient.from(getDynamoDBClient(region));
  }
  return dynamoDBDocClient;
}

/**
 * Individual API entry within a token
 * Multiple APIs can be registered under a single token
 */
export interface ApiEntry {
  index: number;        // 0-based index (order of registration)
  slug: string;         // Unique slug within the token (e.g., "eigenpie-pool")
  name: string;         // API name/title
  apiUrl: string;       // Builder's API endpoint URL (hidden from public)
  description: string;  // Required description
  fee: string;          // Fee in payment token smallest unit (e.g., "10000" = $0.01 USDC with 6 decimals)
  method?: 'GET' | 'POST';  // HTTP method (defaults to GET)
  createdAt: string;    // ISO timestamp when this API was added
}

/**
 * IAO Token database entry (represents a server/builder)
 * One token can have multiple APIs (1:N relationship)
 * Each API has its own fee (per-API pricing)
 */
/**
 * Normalize address for storage/lookup
 * EVM addresses (0x...) are lowercased for consistency
 * Solana addresses (base58) are kept as-is since base58 is case-sensitive
 */
function normalizeAddress(address: string): string {
  if (address.startsWith('0x')) {
    return address.toLowerCase();
  }
  return address; // Solana addresses - keep original case
}

export interface IAOTokenDBEntry {
  id: string;                    // Token address (lowercase) - Primary Key
  slug: string;                  // Unique server slug (e.g., "magpie")
  name: string;                  // Token/server name
  symbol: string;                // Token symbol
  builder: string;               // Builder address (lowercase for EVM, original case for Solana)
  paymentToken: string;          // Payment token address
  chainId: string;               // Chain ID: "84532" (Base Sepolia), "devnet" (Solana), etc.
  subscriptionCount: string;     // BigInt as string, default "0" - aggregated across all APIs
  refundCount: string;           // BigInt as string, default "0"
  fulfilledCount: string;        // BigInt as string, default "0"
  totalFeesCollected?: string;   // BigInt as string - for Solana bonding progress tracking
  tags?: string[];               // Array of category tags (e.g., ["crypto", "trading"])
  apis: ApiEntry[];              // Array of registered APIs (each with own fee)
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
}

class DynamoDBService {
  private ddbDocClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(region: string, tableName: string) {
    this.ddbDocClient = getDynamoDBDocClient(region);
    this.tableName = tableName;
  }

  async putItem(item: IAOTokenDBEntry): Promise<void> {
    const params = {
      TableName: this.tableName,
      Item: item,
    };

    try {
      await this.ddbDocClient.send(new PutCommand(params));
      console.log(`✅ DynamoDB putItem success for ${item.id}`);
    } catch (err) {
      console.error(`❌ DynamoDB putItem fail for ${item.id}:`, err);
      throw err;
    }
  }

  async getItem(id: string): Promise<IAOTokenDBEntry | null> {
    const normalizedId = normalizeAddress(id);
    const params = {
      TableName: this.tableName,
      Key: { id: normalizedId },
    };

    try {
      const data = await this.ddbDocClient.send(new GetCommand(params));
      return (data.Item as IAOTokenDBEntry) || null;
    } catch (err) {
      console.error(`❌ DynamoDB getItem fail for ${id}:`, err);
      return null;
    }
  }

  async deleteItem(id: string): Promise<void> {
    const normalizedId = normalizeAddress(id);
    const params = {
      TableName: this.tableName,
      Key: { id: normalizedId },
    };

    try {
      await this.ddbDocClient.send(new DeleteCommand(params));
      console.log(`✅ DynamoDB deleteItem success for ${id}`);
    } catch (err) {
      console.error(`❌ DynamoDB deleteItem fail for ${id}:`, err);
      throw err;
    }
  }

  async scanAllItems(): Promise<IAOTokenDBEntry[]> {
    const params = {
      TableName: this.tableName,
    };

    try {
      const data = await this.ddbDocClient.send(new ScanCommand(params));
      return (data.Items as IAOTokenDBEntry[]) || [];
    } catch (err) {
      console.error("❌ DynamoDB scanAllItems error:", err);
      throw err;
    }
  }

  async scanItemsByBuilder(builderAddress: string): Promise<IAOTokenDBEntry[]> {
    const normalizedBuilder = normalizeAddress(builderAddress);
    const params = {
      TableName: this.tableName,
      FilterExpression: "#builder = :builder",
      ExpressionAttributeNames: {
        "#builder": "builder"
      },
      ExpressionAttributeValues: {
        ":builder": normalizedBuilder
      }
    };

    try {
      const data = await this.ddbDocClient.send(new ScanCommand(params));
      return (data.Items as IAOTokenDBEntry[]) || [];
    } catch (err) {
      console.error(`❌ DynamoDB scanItemsByBuilder error for ${builderAddress}:`, err);
      throw err;
    }
  }

  /**
   * Get a token by its slug using GSI for O(1) lookup
   * Falls back to Scan if GSI doesn't exist (backwards compatible)
   */
  async getItemBySlug(slug: string): Promise<IAOTokenDBEntry | null> {
    const normalizedSlug = slug.toLowerCase();

    // Try GSI query first (O(1) lookup)
    try {
      const queryParams = {
        TableName: this.tableName,
        IndexName: "slug-index",
        KeyConditionExpression: "#slug = :slug",
        ExpressionAttributeNames: {
          "#slug": "slug"
        },
        ExpressionAttributeValues: {
          ":slug": normalizedSlug
        }
      };

      const data = await this.ddbDocClient.send(new QueryCommand(queryParams));
      const items = data.Items as IAOTokenDBEntry[];
      if (items && items.length > 0) {
        return items[0];
      }
      return null;
    } catch (err: any) {
      // If GSI doesn't exist, fall back to Scan
      if (err.name === 'ValidationException' && err.message?.includes('slug-index')) {
        console.warn(`⚠️ GSI slug-index not found, falling back to Scan for slug: ${slug}`);
        return this.getItemBySlugFallback(normalizedSlug);
      }
      console.error(`❌ DynamoDB getItemBySlug fail for ${slug}:`, err);
      return null;
    }
  }

  /**
   * Fallback method using Scan (for backwards compatibility when GSI doesn't exist)
   */
  private async getItemBySlugFallback(slug: string): Promise<IAOTokenDBEntry | null> {
    const params = {
      TableName: this.tableName,
      FilterExpression: "#slug = :slug",
      ExpressionAttributeNames: {
        "#slug": "slug"
      },
      ExpressionAttributeValues: {
        ":slug": slug
      }
    };

    try {
      const data = await this.ddbDocClient.send(new ScanCommand(params));
      const items = data.Items as IAOTokenDBEntry[];
      return items && items.length > 0 ? items[0] : null;
    } catch (err) {
      console.error(`❌ DynamoDB getItemBySlugFallback fail for ${slug}:`, err);
      return null;
    }
  }

  /**
   * Check if a server slug already exists
   */
  async slugExists(slug: string): Promise<boolean> {
    const token = await this.getItemBySlug(slug);
    return token !== null;
  }

  /**
   * Check if an API URL already exists globally across all servers
   * Returns the server slug and token address if found
   */
  async apiUrlExists(apiUrl: string): Promise<{ exists: boolean; serverSlug?: string; tokenAddress?: string }> {
    try {
      const tokens = await this.scanAllItems();
      for (const token of tokens) {
        if (token.apis) {
          const matchingApi = token.apis.find(api => api.apiUrl === apiUrl);
          if (matchingApi) {
            return {
              exists: true,
              serverSlug: token.slug,
              tokenAddress: token.id
            };
          }
        }
      }
      return { exists: false };
    } catch (err) {
      console.error(`❌ DynamoDB apiUrlExists error:`, err);
      return { exists: false };
    }
  }

  /**
   * Check if multiple API URLs exist globally
   * Returns array of duplicates found
   */
  async checkApiUrlsDuplicate(apiUrls: string[]): Promise<{ url: string; serverSlug: string; tokenAddress: string }[]> {
    try {
      const tokens = await this.scanAllItems();
      const duplicates: { url: string; serverSlug: string; tokenAddress: string }[] = [];
      
      for (const token of tokens) {
        if (token.apis) {
          for (const api of token.apis) {
            if (apiUrls.includes(api.apiUrl)) {
              duplicates.push({
                url: api.apiUrl,
                serverSlug: token.slug,
                tokenAddress: token.id
              });
            }
          }
        }
      }
      
      return duplicates;
    } catch (err) {
      console.error(`❌ DynamoDB checkApiUrlsDuplicate error:`, err);
      return [];
    }
  }

  /**
   * Add a new API to an existing token
   * The new API will be assigned the next available index
   */
  async addApiToToken(tokenAddress: string, apiSlug: string, apiName: string, apiUrl: string, description: string, fee: string, method: 'GET' | 'POST' = 'GET'): Promise<ApiEntry | null> {
    const token = await this.getItem(tokenAddress);
    if (!token) {
      console.error(`❌ Token ${tokenAddress} not found`);
      return null;
    }

    // Ensure apis array exists
    const apis = token.apis || [];

    // Check if API slug already exists within this token
    if (apis.some(api => api.slug === apiSlug.toLowerCase())) {
      console.error(`❌ API slug ${apiSlug} already exists in token ${tokenAddress}`);
      return null;
    }

    // Calculate next index
    const nextIndex = apis.length;

    // Create new API entry
    const newApi: ApiEntry = {
      index: nextIndex,
      slug: apiSlug.toLowerCase(),
      name: apiName,
      apiUrl: apiUrl,
      description: description,
      fee: fee,
      method: method,
      createdAt: new Date().toISOString(),
    };

    // Add to apis array
    apis.push(newApi);

    // Update token
    const updatedToken: IAOTokenDBEntry = {
      ...token,
      apis: apis,
      updatedAt: new Date().toISOString(),
    };

    await this.putItem(updatedToken);
    console.log(`✅ Added API ${apiName} (slug: ${apiSlug}, index: ${nextIndex}) to token ${tokenAddress}`);
    
    return newApi;
  }

  /**
   * Get a specific API from a token by slug
   */
  getApiBySlug(token: IAOTokenDBEntry, apiSlug: string): ApiEntry | null {
    if (!token.apis || token.apis.length === 0) {
      return null;
    }
    return token.apis.find(api => api.slug === apiSlug.toLowerCase()) || null;
  }

  /**
   * Get a specific API from a token by index
   */
  getApiByIndex(token: IAOTokenDBEntry, index: number): ApiEntry | null {
    if (!token.apis || token.apis.length === 0) {
      return null;
    }
    return token.apis.find(api => api.index === index) || null;
  }
}

export { DynamoDBService };

