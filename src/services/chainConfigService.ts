/**
 * Chain Configuration Service
 * Manages blockchain network configurations for multi-chain support
 * Supports EVM (Base Sepolia) and Solana (Devnet)
 */

import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

let dynamoDBClient: DynamoDBClient | null = null;
let dynamoDBDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDBClient(region: string): DynamoDBClient {
  if (!dynamoDBClient) {
    dynamoDBClient = new DynamoDBClient({
      region,
      endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
    });
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
 * Supported chain types
 */
export type ChainType = "evm" | "solana";

/**
 * Chain configuration entry stored in DynamoDB
 */
export interface ChainConfigEntry {
  chainId: string;                  // Primary Key: "84532" (Base Sepolia) or "devnet" (Solana)
  chainType: ChainType;             // "evm" or "solana"
  name: string;                     // Display name (e.g., "Base Sepolia", "Solana Devnet")
  shortName: string;                // Short name for UI chips (e.g., "Base", "Solana")
  factoryAddress: string;           // IAO Token Factory contract/program address
  paymentTokenAddress: string;      // USDC contract/mint address
  paymentTokenSymbol: string;       // Payment token symbol (e.g., "USDC")
  paymentTokenDecimals: number;     // Payment token decimals (usually 6 for USDC)
  rpcUrl: string;                   // RPC endpoint URL
  explorerUrl: string;              // Block explorer base URL
  explorerTxPath: string;           // Transaction path pattern (e.g., "/tx/" or "/tx/")
  explorerAddressPath: string;      // Address path pattern (e.g., "/address/" or "/account/")
  enabled: boolean;                 // Whether this chain is enabled for new servers
  createdAt: string;                // ISO timestamp
  updatedAt: string;                // ISO timestamp
}

/**
 * Default chain configurations for seeding
 */
export const DEFAULT_CHAIN_CONFIGS: ChainConfigEntry[] = [
  {
    chainId: "84532",
    chainType: "evm",
    name: "Base Sepolia",
    shortName: "Base",
    factoryAddress: "0xF110bA6BBc7cD595842B6b56ab870faC811e41B5", // Existing IAO Factory
    paymentTokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC on Base Sepolia
    paymentTokenSymbol: "USDC",
    paymentTokenDecimals: 6,
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    explorerTxPath: "/tx/",
    explorerAddressPath: "/address/",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    chainId: "devnet",
    chainType: "solana",
    name: "Solana Devnet",
    shortName: "Solana",
    factoryAddress: "FpCX6E1LxRph23NJgF9R8haRJscGPbbdhP2vd5Sn6jwA", // IAO Factory Program
    paymentTokenAddress: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // USDC on Solana Devnet
    paymentTokenSymbol: "USDC",
    paymentTokenDecimals: 6,
    rpcUrl: "https://api.devnet.solana.com",
    explorerUrl: "https://explorer.solana.com",
    explorerTxPath: "/tx/",
    explorerAddressPath: "/address/",
    enabled: true, // Solana program deployed
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

class ChainConfigService {
  private ddbDocClient: DynamoDBDocumentClient;
  private tableName: string;
  private region: string;

  constructor(region: string, tableName: string) {
    this.region = region;
    this.ddbDocClient = getDynamoDBDocClient(region);
    this.tableName = tableName;
  }

  /**
   * Get a chain configuration by chainId
   */
  async getChainConfig(chainId: string): Promise<ChainConfigEntry | null> {
    try {
      const result = await this.ddbDocClient.send(new GetCommand({
        TableName: this.tableName,
        Key: { chainId },
      }));

      return result.Item as ChainConfigEntry | null;
    } catch (error) {
      console.error(`❌ Failed to get chain config for ${chainId}:`, error);
      return null;
    }
  }

  /**
   * Get all chain configurations
   */
  async getAllChains(): Promise<ChainConfigEntry[]> {
    try {
      const result = await this.ddbDocClient.send(new ScanCommand({
        TableName: this.tableName,
      }));

      return (result.Items as ChainConfigEntry[]) || [];
    } catch (error) {
      console.error(`❌ Failed to get all chains:`, error);
      return [];
    }
  }

  /**
   * Get all enabled chain configurations
   */
  async getAllEnabledChains(): Promise<ChainConfigEntry[]> {
    try {
      const result = await this.ddbDocClient.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "#enabled = :enabled",
        ExpressionAttributeNames: {
          "#enabled": "enabled",
        },
        ExpressionAttributeValues: {
          ":enabled": true,
        },
      }));

      return (result.Items as ChainConfigEntry[]) || [];
    } catch (error) {
      console.error(`❌ Failed to get enabled chains:`, error);
      return [];
    }
  }

  /**
   * Get chain configuration by chain type
   */
  async getChainsByType(chainType: ChainType): Promise<ChainConfigEntry[]> {
    try {
      const result = await this.ddbDocClient.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "#chainType = :chainType",
        ExpressionAttributeNames: {
          "#chainType": "chainType",
        },
        ExpressionAttributeValues: {
          ":chainType": chainType,
        },
      }));

      return (result.Items as ChainConfigEntry[]) || [];
    } catch (error) {
      console.error(`❌ Failed to get chains by type ${chainType}:`, error);
      return [];
    }
  }

  /**
   * Create or update a chain configuration
   */
  async putChainConfig(config: ChainConfigEntry): Promise<void> {
    try {
      const now = new Date().toISOString();
      const item: ChainConfigEntry = {
        ...config,
        updatedAt: now,
        createdAt: config.createdAt || now,
      };

      await this.ddbDocClient.send(new PutCommand({
        TableName: this.tableName,
        Item: item,
      }));

      console.log(`✅ Chain config saved for ${config.chainId} (${config.name})`);
    } catch (error) {
      console.error(`❌ Failed to save chain config for ${config.chainId}:`, error);
      throw error;
    }
  }

  /**
   * Update the factory address for a chain (used after deploying Solana program)
   */
  async updateFactoryAddress(chainId: string, factoryAddress: string): Promise<void> {
    try {
      await this.ddbDocClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { chainId },
        UpdateExpression: "SET factoryAddress = :factoryAddress, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":factoryAddress": factoryAddress,
          ":updatedAt": new Date().toISOString(),
        },
      }));

      console.log(`✅ Factory address updated for chain ${chainId}: ${factoryAddress}`);
    } catch (error) {
      console.error(`❌ Failed to update factory address for ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Enable or disable a chain
   */
  async setChainEnabled(chainId: string, enabled: boolean): Promise<void> {
    try {
      await this.ddbDocClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { chainId },
        UpdateExpression: "SET #enabled = :enabled, updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#enabled": "enabled",
        },
        ExpressionAttributeValues: {
          ":enabled": enabled,
          ":updatedAt": new Date().toISOString(),
        },
      }));

      console.log(`✅ Chain ${chainId} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error(`❌ Failed to ${enabled ? 'enable' : 'disable'} chain ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a chain configuration
   */
  async deleteChainConfig(chainId: string): Promise<void> {
    try {
      await this.ddbDocClient.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { chainId },
      }));

      console.log(`✅ Chain config deleted for ${chainId}`);
    } catch (error) {
      console.error(`❌ Failed to delete chain config for ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Seed default chain configurations
   * Only creates entries that don't already exist
   */
  async seedDefaultConfigs(): Promise<void> {
    console.log("🌱 Seeding default chain configurations...");

    for (const config of DEFAULT_CHAIN_CONFIGS) {
      const existing = await this.getChainConfig(config.chainId);
      if (!existing) {
        await this.putChainConfig(config);
        console.log(`   ✅ Created config for ${config.name}`);
      } else {
        console.log(`   ⏭️  Config already exists for ${config.name}`);
      }
    }

    console.log("🌱 Seeding complete");
  }

  /**
   * Get explorer URL for a transaction
   */
  getTransactionUrl(chainConfig: ChainConfigEntry, txHash: string): string {
    // For Solana, add cluster parameter for devnet
    if (chainConfig.chainType === "solana" && chainConfig.chainId === "devnet") {
      return `${chainConfig.explorerUrl}${chainConfig.explorerTxPath}${txHash}?cluster=devnet`;
    }
    return `${chainConfig.explorerUrl}${chainConfig.explorerTxPath}${txHash}`;
  }

  /**
   * Get explorer URL for an address
   */
  getAddressUrl(chainConfig: ChainConfigEntry, address: string): string {
    // For Solana, add cluster parameter for devnet
    if (chainConfig.chainType === "solana" && chainConfig.chainId === "devnet") {
      return `${chainConfig.explorerUrl}${chainConfig.explorerAddressPath}${address}?cluster=devnet`;
    }
    return `${chainConfig.explorerUrl}${chainConfig.explorerAddressPath}${address}`;
  }

  /**
   * Check if a chainId is valid and enabled
   */
  async isChainValid(chainId: string): Promise<boolean> {
    const config = await this.getChainConfig(chainId);
    return config !== null && config.enabled;
  }

  /**
   * Get chain config with validation (throws if not found or disabled)
   */
  async getChainConfigOrThrow(chainId: string): Promise<ChainConfigEntry> {
    const config = await this.getChainConfig(chainId);

    if (!config) {
      throw new Error(`Chain ${chainId} not found`);
    }

    if (!config.enabled) {
      throw new Error(`Chain ${chainId} is currently disabled`);
    }

    return config;
  }
}

export { ChainConfigService };
