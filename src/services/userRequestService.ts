import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

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

export interface UserRequestDBEntry {
  id: string; // Composite key: `${iaoToken}#${from}` (lowercase for EVM, original for Solana)
  iaoToken: string; // Token address (lowercase for EVM, original for Solana)
  from: string; // User address (lowercase for EVM, original for Solana)
  totalRequest: string; // BigInt as string
  fulfilledRequest: string; // BigInt as string
  refundRequest: string; // BigInt as string
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface RequestQueueDBEntry {
  id: string; // Unique identifier: `${iaoToken}#${from}#${userRequestNumber}`
  iaoToken: string; // Token address (lowercase for EVM, original for Solana)
  from: string; // User address (lowercase for EVM, original for Solana)
  userRequestNumber: string; // BigInt as string
  globalRequestNumber: string; // BigInt as string
  fee: string; // Fee paid by user in payment token wei (e.g., "10000" for $0.01)
  createdAt: string; // ISO timestamp
}

/**
 * Normalize address based on type
 * EVM addresses (0x...) are lowercased for consistency
 * Solana addresses (base58) are kept original because base58 is case-sensitive
 */
function normalizeAddress(address: string): string {
  if (address.startsWith('0x')) {
    return address.toLowerCase(); // EVM address
  }
  return address; // Solana address - keep original case
}

class UserRequestService {
  private ddbDocClient: DynamoDBDocumentClient;
  private userRequestTableName: string;
  private requestQueueTableName: string;

  constructor(region: string, userRequestTableName: string, requestQueueTableName: string) {
    this.ddbDocClient = getDynamoDBDocClient(region);
    this.userRequestTableName = userRequestTableName;
    this.requestQueueTableName = requestQueueTableName;
  }

  /**
   * Get or create a user request
   */
  async getOrCreateUserRequest(iaoToken: string, from: string): Promise<UserRequestDBEntry> {
    const normalizedToken = normalizeAddress(iaoToken);
    const normalizedFrom = normalizeAddress(from);
    const id = `${normalizedToken}#${normalizedFrom}`;
    const params = {
      TableName: this.userRequestTableName,
      Key: { id },
    };

    try {
      const data = await this.ddbDocClient.send(new GetCommand(params));
      if (data.Item) {
        return data.Item as UserRequestDBEntry;
      }

      // Create new user request
      const now = new Date().toISOString();
      const newUserRequest: UserRequestDBEntry = {
        id,
        iaoToken: normalizedToken,
        from: normalizedFrom,
        totalRequest: "0",
        fulfilledRequest: "0",
        refundRequest: "0",
        createdAt: now,
        updatedAt: now,
      };

      await this.ddbDocClient.send(new PutCommand({
        TableName: this.userRequestTableName,
        Item: newUserRequest,
      }));

      return newUserRequest;
    } catch (err) {
      console.error(`❌ DynamoDB getOrCreateUserRequest fail for ${id}:`, err);
      throw err;
    }
  }

  /**
   * Increment totalRequest and create a RequestQueue entry
   */
  async createRequestQueueEntry(
    iaoToken: string,
    from: string,
    globalRequestNumber: string,
    fee: string
  ): Promise<RequestQueueDBEntry> {
    try {
      // Get or create user request
      const userRequest = await this.getOrCreateUserRequest(iaoToken, from);

      // Increment totalRequest
      const newTotalRequest = (BigInt(userRequest.totalRequest) + BigInt(1)).toString();
      const userRequestNumber = newTotalRequest; // userRequestNumber is the same as totalRequest

      // Update user request
      await this.ddbDocClient.send(new UpdateCommand({
        TableName: this.userRequestTableName,
        Key: { id: userRequest.id },
        UpdateExpression: "SET totalRequest = :totalRequest, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":totalRequest": newTotalRequest,
          ":updatedAt": new Date().toISOString(),
        },
      }));

      // Create request queue entry
      const normalizedToken = normalizeAddress(iaoToken);
      const normalizedFrom = normalizeAddress(from);
      const queueId = `${normalizedToken}#${normalizedFrom}#${userRequestNumber}`;
      const requestQueueEntry: RequestQueueDBEntry = {
        id: queueId,
        iaoToken: normalizedToken,
        from: normalizedFrom,
        userRequestNumber,
        globalRequestNumber,
        fee,
        createdAt: new Date().toISOString(),
      };

      await this.ddbDocClient.send(new PutCommand({
        TableName: this.requestQueueTableName,
        Item: requestQueueEntry,
      }));

      console.log(`✅ Created RequestQueue entry: ${queueId} (globalRequestNumber: ${globalRequestNumber}, fee: ${fee})`);
      return requestQueueEntry;
    } catch (err) {
      console.error(`❌ DynamoDB createRequestQueueEntry fail:`, err);
      throw err;
    }
  }

  /**
   * Scan all user requests from the table
   */
  async scanAllUserRequests(): Promise<UserRequestDBEntry[]> {
    const items: UserRequestDBEntry[] = [];
    let lastEvaluatedKey: any = undefined;

    try {
      do {
        const params: any = {
          TableName: this.userRequestTableName,
        };

        if (lastEvaluatedKey) {
          params.ExclusiveStartKey = lastEvaluatedKey;
        }

        const data = await this.ddbDocClient.send(new ScanCommand(params));
        
        if (data.Items) {
          items.push(...(data.Items as UserRequestDBEntry[]));
        }

        lastEvaluatedKey = data.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      return items;
    } catch (err) {
      console.error(`❌ DynamoDB scanAllUserRequests fail:`, err);
      throw err;
    }
  }

  /**
   * Scan all request queue entries from the table
   */
  async scanAllRequestQueue(): Promise<RequestQueueDBEntry[]> {
    const items: RequestQueueDBEntry[] = [];
    let lastEvaluatedKey: any = undefined;

    try {
      do {
        const params: any = {
          TableName: this.requestQueueTableName,
        };

        if (lastEvaluatedKey) {
          params.ExclusiveStartKey = lastEvaluatedKey;
        }

        const data = await this.ddbDocClient.send(new ScanCommand(params));
        
        if (data.Items) {
          items.push(...(data.Items as RequestQueueDBEntry[]));
        }

        lastEvaluatedKey = data.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      return items;
    } catch (err) {
      console.error(`❌ DynamoDB scanAllRequestQueue fail:`, err);
      throw err;
    }
  }

  /**
   * Get recent transactions (request queue entries) sorted by createdAt descending
   * @param limit - Maximum number of transactions to return (default: 20)
   */
  async getRecentTransactions(limit: number = 20): Promise<RequestQueueDBEntry[]> {
    try {
      // Scan all and sort (Note: For production with large datasets, consider using DynamoDB Streams or a GSI with sort key)
      const allTransactions = await this.scanAllRequestQueue();
      
      // Sort by createdAt descending (most recent first)
      allTransactions.sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      // Return limited results
      return allTransactions.slice(0, limit);
    } catch (err) {
      console.error(`❌ Failed to get recent transactions:`, err);
      throw err;
    }
  }
}

export { UserRequestService };

