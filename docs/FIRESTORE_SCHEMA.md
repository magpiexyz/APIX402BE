# Firestore Schema Documentation

This document describes the Firestore collections, document structures, indexes, and query patterns used in the APIX platform.

## Collections Overview

| Collection | Purpose | Key Operations |
|------------|---------|----------------|
| `iao-tokens` | API server/token registry | CRUD, query by slug/chain |
| `user-requests` | API call history | Create, query by user/token |
| `request-queue` | Pending token distribution | Create, process, delete |
| `api-metrics` | Performance metrics | Upsert, aggregate queries |
| `agents` | AI agent configurations | CRUD |
| `chat-sessions` | Agent conversation sessions | Create, query by user |
| `chat-messages` | Individual chat messages | Append, query by session |
| `agent-payments` | Agent usage payments | Create, query by user/agent |
| `cache` | Temporary cached data | Get/set with TTL |
| `rate-limits` | Rate limiting counters | Increment, check limits |
| `chain-configs` | Multi-chain settings | Read-only lookups |
| `alerts` | System alerts | CRUD |
| `webhooks` | Webhook configurations | CRUD |

---

## Collection Schemas

### iao-tokens

Stores registered API servers and their associated IAO tokens.

```typescript
interface IAOToken {
  // Document ID: token address (lowercase)
  id: string;

  // Server identification
  slug: string;              // Unique URL slug (e.g., "magpie")
  name: string;              // Display name
  description?: string;      // Server description

  // Blockchain info
  tokenAddress: string;      // IAO token contract address
  chainId: number;           // Network chain ID (e.g., 84532 for Base Sepolia)

  // API endpoints
  apis: Array<{
    slug: string;            // API endpoint slug
    name: string;            // API display name
    description?: string;
    endpoint: string;        // Full URL to builder endpoint
    method: 'GET' | 'POST';
    fee: string;             // Fee in smallest unit (wei/lamports)
    feeToken: string;        // Payment token address
  }>;

  // Metrics (denormalized for quick access)
  subscriptionCount: number; // Total successful API calls
  totalRevenue: string;      // Total revenue in payment token units

  // Builder info
  builderAddress: string;    // Server owner's wallet address

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Indexes Required:**
- `slug` (ascending) - Query by server slug
- `chainId` (ascending) - Filter by blockchain
- `builderAddress` (ascending) - Query by owner
- Composite: `chainId` + `createdAt` (descending) - List servers by chain

### user-requests

Tracks individual API calls made by users.

```typescript
interface UserRequest {
  // Document ID: {tokenAddress}_{userAddress}_{requestNumber}
  id: string;

  // References
  iaoToken: string;          // Token address
  userAddress: string;       // Caller's wallet
  apiSlug: string;           // Which API was called

  // Request details
  requestNumber: number;     // Sequential number per user+token
  fee: string;               // Fee paid
  feeToken: string;          // Payment token used

  // Payment info
  paymentTxHash?: string;    // On-chain settlement transaction
  paymentStatus: 'pending' | 'settled' | 'failed';

  // Response info
  responseStatus: number;    // HTTP status from builder
  responseTime: number;      // Latency in ms

  // Token distribution
  tokensDistributed?: string; // IAO tokens minted (if applicable)

  // Timestamps
  createdAt: Timestamp;
  settledAt?: Timestamp;
}
```

**Indexes Required:**
- `iaoToken` (ascending) - Query by token
- `userAddress` (ascending) - Query by user
- Composite: `iaoToken` + `userAddress` + `createdAt` - User history for token
- Composite: `userAddress` + `createdAt` (descending) - Recent calls by user

### request-queue

Queue for pending token distribution after successful payments.

```typescript
interface QueuedRequest {
  // Document ID: {tokenAddress}_{userAddress}_{requestNumber}
  id: string;

  // References
  iaoToken: string;
  userAddress: string;
  requestNumber: number;

  // Distribution details
  fee: string;
  feeToken: string;
  chainId: number;

  // Processing status
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retryCount: number;
  lastError?: string;

  // Timestamps
  createdAt: Timestamp;
  processedAt?: Timestamp;
}
```

**Indexes Required:**
- `status` (ascending) + `createdAt` (ascending) - Process oldest pending first
- `iaoToken` (ascending) - Query queue by token

### api-metrics

Aggregated performance and revenue metrics per API.

```typescript
interface APIMetrics {
  // Document ID: {tokenAddress}_{apiSlug}
  id: string;

  // References
  iaoToken: string;
  apiSlug: string;

  // Call metrics
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;

  // Performance metrics
  avgResponseTime: number;   // Average latency in ms
  p50ResponseTime: number;   // 50th percentile
  p95ResponseTime: number;   // 95th percentile
  p99ResponseTime: number;   // 99th percentile

  // Revenue metrics
  totalRevenue: string;      // Total fees collected
  last24hRevenue: string;    // Rolling 24h revenue
  last7dRevenue: string;     // Rolling 7d revenue

  // Error tracking
  lastError?: string;
  lastErrorAt?: Timestamp;
  errorRate: number;         // Percentage (0-100)

  // Timestamps
  updatedAt: Timestamp;
}
```

**Indexes Required:**
- `iaoToken` (ascending) - All metrics for a server
- `totalCalls` (descending) - Most popular APIs

### agents

AI agent configurations and metadata.

```typescript
interface Agent {
  // Document ID: auto-generated
  id: string;

  // Agent info
  name: string;
  description: string;
  systemPrompt: string;

  // Model configuration
  model: string;             // e.g., "gpt-4", "claude-3"
  temperature: number;
  maxTokens: number;

  // Pricing
  pricePerMessage: string;   // Fee per message
  priceToken: string;        // Payment token address

  // Owner
  ownerAddress: string;

  // Status
  isActive: boolean;

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### chat-sessions

Tracks conversation sessions between users and agents.

```typescript
interface ChatSession {
  // Document ID: auto-generated
  id: string;

  // References
  agentId: string;
  userAddress: string;

  // Session info
  title?: string;            // Optional session title
  messageCount: number;

  // Status
  isActive: boolean;

  // Timestamps
  createdAt: Timestamp;
  lastMessageAt: Timestamp;
}
```

**Indexes Required:**
- `userAddress` + `lastMessageAt` (descending) - User's recent sessions
- `agentId` + `createdAt` (descending) - Sessions per agent

### chat-messages

Individual messages within chat sessions.

```typescript
interface ChatMessage {
  // Document ID: auto-generated
  id: string;

  // References
  sessionId: string;

  // Message content
  role: 'user' | 'assistant' | 'system';
  content: string;

  // Token usage (for assistant messages)
  inputTokens?: number;
  outputTokens?: number;

  // Payment (for user messages)
  paymentId?: string;        // Reference to agent-payments

  // Timestamps
  createdAt: Timestamp;
}
```

**Indexes Required:**
- `sessionId` + `createdAt` (ascending) - Messages in order

### agent-payments

Tracks payments for agent usage.

```typescript
interface AgentPayment {
  // Document ID: auto-generated
  id: string;

  // References
  agentId: string;
  sessionId: string;
  userAddress: string;

  // Payment details
  amount: string;
  token: string;
  txHash?: string;

  // Status
  status: 'pending' | 'settled' | 'failed';

  // Timestamps
  createdAt: Timestamp;
  settledAt?: Timestamp;
}
```

### cache

General-purpose caching layer with TTL.

```typescript
interface CacheEntry {
  // Document ID: cache key
  key: string;

  // Cached data
  value: any;                // JSON-serializable data

  // TTL
  expiresAt: Timestamp;

  // Metadata
  createdAt: Timestamp;
}
```

**Indexes Required:**
- `expiresAt` (ascending) - For cleanup of expired entries

### rate-limits

Tracks rate limiting for users and APIs.

```typescript
interface RateLimit {
  // Document ID: {type}_{identifier}_{window}
  // e.g., "user_0x123_minute" or "api_magpie_hour"
  id: string;

  // Limit info
  type: 'user' | 'api' | 'global';
  identifier: string;        // User address or API slug
  window: 'second' | 'minute' | 'hour' | 'day';

  // Counter
  count: number;
  limit: number;

  // Window tracking
  windowStart: Timestamp;
  windowEnd: Timestamp;
}
```

### chain-configs

Multi-chain network configurations.

```typescript
interface ChainConfig {
  // Document ID: chainId as string
  id: string;

  // Network info
  chainId: number;
  name: string;              // e.g., "Base Sepolia"
  networkType: 'evm' | 'solana';

  // RPC endpoints
  rpcUrl: string;
  wsUrl?: string;

  // Contract addresses
  factoryAddress: string;    // IAOTokenFactory address

  // Payment tokens
  paymentTokens: Array<{
    address: string;
    symbol: string;
    decimals: number;
  }>;

  // Explorer
  explorerUrl: string;

  // Status
  isActive: boolean;
}
```

### alerts

System alerting configuration and history.

```typescript
interface Alert {
  // Document ID: auto-generated
  id: string;

  // Alert definition
  name: string;
  type: 'error_rate' | 'latency' | 'revenue' | 'custom';
  condition: string;         // e.g., "error_rate > 5%"

  // Target
  targetType: 'global' | 'server' | 'api';
  targetId?: string;         // Token address or API slug

  // Notification
  webhookUrl?: string;
  email?: string;

  // Status
  isActive: boolean;
  lastTriggeredAt?: Timestamp;

  // Timestamps
  createdAt: Timestamp;
}
```

### webhooks

External webhook configurations.

```typescript
interface Webhook {
  // Document ID: auto-generated
  id: string;

  // Owner
  ownerAddress: string;

  // Webhook config
  url: string;
  events: string[];          // e.g., ["api.call", "payment.settled"]
  secret: string;            // For signature verification

  // Target (optional, for filtering)
  targetTokenAddress?: string;

  // Status
  isActive: boolean;
  lastCalledAt?: Timestamp;
  failureCount: number;

  // Timestamps
  createdAt: Timestamp;
}
```

---

## Query Patterns

### Get Server by Slug
```typescript
const serverRef = db.collection('iao-tokens')
  .where('slug', '==', slug)
  .where('chainId', '==', chainId)
  .limit(1);
```

### Get User's Recent Calls
```typescript
const callsRef = db.collection('user-requests')
  .where('userAddress', '==', userAddress)
  .orderBy('createdAt', 'desc')
  .limit(50);
```

### Get Pending Queue Items
```typescript
const queueRef = db.collection('request-queue')
  .where('status', '==', 'pending')
  .orderBy('createdAt', 'asc')
  .limit(100);
```

### Check Rate Limit
```typescript
const limitRef = db.collection('rate-limits')
  .doc(`user_${userAddress}_minute`);
```

### Get Chat History
```typescript
const messagesRef = db.collection('chat-messages')
  .where('sessionId', '==', sessionId)
  .orderBy('createdAt', 'asc');
```

---

## Index Definitions

Create these composite indexes in `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "iao-tokens",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "chainId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "user-requests",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "iaoToken", "order": "ASCENDING" },
        { "fieldPath": "userAddress", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "user-requests",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userAddress", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "request-queue",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "chat-sessions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userAddress", "order": "ASCENDING" },
        { "fieldPath": "lastMessageAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "chat-messages",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sessionId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    }
  ]
}
```

Deploy indexes:
```bash
firebase deploy --only firestore:indexes
```

---

## Security Rules

Basic security rules for Firestore:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Backend has full access via service account
    // These rules apply to client-side access only

    match /iao-tokens/{tokenId} {
      allow read: if true;  // Public read
      allow write: if false; // Backend only
    }

    match /user-requests/{requestId} {
      allow read: if request.auth != null &&
        resource.data.userAddress == request.auth.token.address;
      allow write: if false;
    }

    match /chat-sessions/{sessionId} {
      allow read: if request.auth != null &&
        resource.data.userAddress == request.auth.token.address;
      allow write: if false;
    }

    match /chat-messages/{messageId} {
      allow read: if request.auth != null;
      allow write: if false;
    }

    // Deny all other collections (backend-only)
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
