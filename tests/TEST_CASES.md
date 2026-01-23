# Test Cases Explained

This document describes what each test case does and why it matters.

**Total Tests: 611**
**Coverage: 99.38% statements, 94.21% branches, 98.9% functions, 99.55% lines**

---

## Table of Contents

1. [FirestoreTokenService](#firestoretokenservice)
2. [FirestoreUserRequestService](#firestoreuserrequestservice)
3. [FirestoreChatSessionService](#firestorechatsessionservice)
4. [FirestoreAgentService](#firestoreagentservice)
5. [FirestoreAgentPaymentService](#firestoreagentpaymentservice)
6. [FirestoreMetricsService](#firestoremetricsservice)
7. [FirestoreCacheService](#firestorecacheservice)
8. [FirestoreRateLimitService](#firestoreratelimitservice)
9. [FirestoreChainConfigService](#firestorechainconfigservice)
10. [FirestoreAlertingService](#firestorealertingservice)
11. [FirestoreClient](#firestoreclient)
12. [LLMService](#llmservice)
13. [MultiChainPaymentService](#multichainpaymentservice)
14. [CircuitBreaker](#circuitbreaker)
15. [RateLimiter Middleware](#ratelimiter-middleware)
16. [JWT Authentication](#jwt-authentication)
17. [AgentToolService](#agenttoolservice)
18. [EVM Contract Service](#evm-contract-service)
19. [Solana Contract Service](#solana-contract-service)
20. [API Routes (x402 & POST Support)](#api-routes-x402--post-support)

---

## FirestoreTokenService

**File:** `tests/firestoreTokenService.test.ts`

Manages IAO token metadata - the core registry of all API servers.

### `putItem` - Create/Update Token

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should store a token successfully` | Happy path - new token saved | Core create operation |
| `should overwrite existing token with same id` | Update existing token | Allows token metadata updates |
| `should throw error on Firestore failure` | Database error | Ensures errors propagate correctly |

### `getItem` - Get Token by ID

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return token when it exists` | Happy path - token found | Core read operation |
| `should return null when token does not exist` | Token not in database | Returns null instead of crashing |
| `should normalize EVM address to lowercase` | Query with `0xABCD...` | Case-insensitive EVM lookups |
| `should preserve Solana address case` | Query with `SoLaNa...` | Solana addresses are case-sensitive |
| `should return null on Firestore error` | Database error | Graceful error handling |

### `deleteItem` - Delete Token

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should delete an existing token` | Happy path - token removed | Core delete operation |
| `should normalize EVM address for deletion` | Delete with uppercase address | Case-insensitive deletion |
| `should not throw when deleting non-existent token` | Token doesn't exist | Idempotent delete operation |
| `should throw error on Firestore failure` | Database error | Ensures errors propagate |

### `scanAllItems` - Get All Tokens

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return all tokens` | Multiple tokens exist | List all servers for marketplace |
| `should return empty array when no tokens exist` | Database is empty | Returns empty array, not null |
| `should throw error on Firestore failure` | Database error | Ensures errors propagate |

### `scanItemsByBuilder` - Get Tokens by Builder

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return tokens for a specific builder` | Builder has tokens | Dashboard shows builder's servers |
| `should return empty array when builder has no tokens` | New builder | Returns empty array, not null |
| `should normalize builder address to lowercase for EVM` | Query with uppercase | Case-insensitive builder lookup |
| `should throw error on Firestore failure` | Database error | Ensures errors propagate |

### `getItemBySlug` - Get Token by URL Slug

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return a token when slug exists` | Happy path - server found | Core routing - `/api/magpie/...` |
| `should return null when slug does not exist` | Server not registered | Returns 404 to user |
| `should normalize slug to lowercase` | Query with `MAGPIE` | Case-insensitive URL routing |
| `should return null on Firestore error` | Database error | Graceful error handling |

### `slugExists` - Check Slug Availability

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return true when slug exists` | Slug already taken | Prevents duplicate registrations |
| `should return false when slug does not exist` | Slug available | Allows new registration |

### `apiUrlExists` - Check API URL Uniqueness

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return exists: true when URL and method match` | Duplicate found | Prevents duplicate API endpoints |
| `should return exists: false when URL exists but method differs` | Same URL, different method | GET and POST to same URL is allowed |
| `should return exists: false when URL does not exist` | New URL | Allows new API registration |
| `should default method to GET when not specified` | Legacy API entry | Backwards compatibility |
| `should return exists: false on error` | Database error | Graceful degradation |
| `should handle tokens with no apis array` | Edge case - empty token | Handles missing arrays |

### `addApiToToken` - Add New API to Existing Token

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should add a new API to existing token` | Happy path | Core API registration |
| `should return null when token does not exist` | Invalid token | Validates token exists |
| `should return null when API slug already exists in token` | Duplicate slug | Prevents duplicate API slugs |
| `should normalize API slug to lowercase` | Slug with uppercase | Consistent slug format |
| `should default method to GET` | No method specified | Sensible default |
| `should initialize apis array if undefined` | New token | Handles missing array |
| `should set createdAt timestamp` | Timestamp check | Audit trail |

### `getApiBySlug` / `getApiByIndex` - Find API

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return API entry when it exists` | Happy path | Routes to correct endpoint |
| `should return null when API does not exist` | API not found | Returns 404 |
| `should handle empty/undefined apis array` | Edge cases | Prevents crashes |

---

## FirestoreUserRequestService

**File:** `tests/firestoreUserRequestService.test.ts`

Tracks user API call history and manages the request queue for token minting.

### `recordRequest` - Log API Call

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should record a new request` | Happy path | Tracks user activity |
| `should increment request count` | Multiple calls | Sequential request numbering |
| `should normalize addresses to lowercase` | EVM addresses | Case-insensitive lookups |

### `getRequestHistory` - User Call History

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return user's request history` | Has history | Dashboard analytics |
| `should return empty array for new user` | No history | Handles new users |
| `should filter by token address` | Multiple tokens | Per-server history |

### `addToQueue` / `processQueue` - Request Queue

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should add request to processing queue` | Queue item | Async token minting |
| `should mark queue items as processed` | Processing | Prevents double-minting |
| `should handle empty queue` | No pending items | Graceful handling |

---

## FirestoreChatSessionService

**File:** `tests/firestoreChatSessionService.test.ts`

Manages AI agent chat sessions and message history.

### `getOrCreateSession` - Session Management

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return existing session if found` | Returning user | Conversation continuity |
| `should create new session if not found` | New user | Auto-creates sessions |
| `should lowercase user address` | EVM address | Case-insensitive |
| `should throw on Firestore error` | Database error | Error propagation |

### `createNewSession` - Force New Session

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should always create a new session` | "New Chat" button | Fresh conversation |
| `should throw on Firestore error` | Database error | Error propagation |

### `saveMessage` - Store Messages

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should save a user message` | User input | Chat history |
| `should save an assistant message` | AI response | Chat history |
| `should save message with tool calls` | Function calling | Agent tools |
| `should save message with tool call ID` | Tool responses | Links results to calls |
| `should truncate very large content` | >300KB message | Prevents storage issues |
| `should extract and store images from data URL` | Base64 images | Image handling |
| `should extract images from JSON content` | Embedded images | DALL-E responses |
| `should handle JSON with null values` | Null fields | Data integrity |
| `should handle JSON with primitive values` | Numbers/booleans | Type preservation |
| `should format large image sizes in MB` | >1MB images | Human-readable sizes |

### `getRecentMessages` - Retrieve History

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return messages for session` | Has messages | Load chat history |
| `should respect limit` | Pagination | Performance |
| `should throw on Firestore error` | Database error | Error propagation |

### `getConversationHistory` - LLM Format

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return user and assistant messages only` | Filter tool messages | Clean LLM context |
| `should throw on Firestore error` | Database error | Error propagation |

### `deleteSession` - Remove Session

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should delete session and all messages` | Cleanup | User data deletion |
| `should throw on Firestore error` | Database error | Error propagation |

---

## FirestoreAgentService

**File:** `tests/firestoreAgentService.test.ts`

Manages AI agent configurations and metadata.

### Agent CRUD Operations

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should create a new agent` | Happy path | Agent registration |
| `should get agent by ID` | Lookup | Agent loading |
| `should get agents by owner` | Dashboard | Owner's agents list |
| `should update agent` | Modify settings | Agent configuration |
| `should delete agent` | Removal | Agent cleanup |
| `should return null for non-existent agent` | Not found | 404 handling |

### Agent Queries

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should get all public agents` | Marketplace | Discovery |
| `should get agents by token` | Per-server agents | Filtering |
| `should handle empty results` | No agents | Empty arrays |

---

## FirestoreAgentPaymentService

**File:** `tests/firestoreAgentPaymentService.test.ts`

Tracks payments made for agent interactions.

### Payment Recording

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should record a payment` | Payment logged | Revenue tracking |
| `should get payments by agent` | Agent earnings | Analytics |
| `should get payments by user` | User spending | User dashboard |
| `should calculate total revenue` | Aggregation | Business metrics |
| `should handle empty results` | No payments | Edge case |

---

## FirestoreMetricsService

**File:** `tests/firestoreMetricsService.test.ts`

Tracks API performance metrics - calls, latency, success rates.

### `recordApiCall` - Log Metrics

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should create new metrics entry for first call` | New API | Initialize counters |
| `should update existing metrics entry` | Subsequent calls | Increment counters |
| `should record failed calls correctly` | Failures | Error tracking |
| `should not throw on Firestore error` | Database error | Non-critical, fail silently |

### `getApiMetrics` - Retrieve Metrics

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return metrics when they exist` | Has data | Dashboard display |
| `should return null when metrics do not exist` | No data | New API handling |
| `should return null on Firestore error` | Database error | Graceful degradation |

### `calculateRecentMetrics` - Compute Stats

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should calculate metrics from recent calls` | Normal data | Accurate stats |
| `should return zeros for empty array` | No calls | Edge case |
| `should calculate p95 latency correctly` | Percentiles | Performance monitoring |
| `should handle single value array` | One call | Edge case |

### `getServerMetrics` - Aggregate Metrics

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should aggregate metrics for all APIs` | Multiple APIs | Server overview |
| `should return empty metrics when no APIs` | New server | Zero values |
| `should handle API with no recent calls` | Historical only | Fallback data |
| `should handle API with zero calls` | Never used | Edge case |

---

## FirestoreCacheService

**File:** `tests/firestoreCacheService.test.ts`

General-purpose caching layer with TTL support.

### Cache Operations

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should set and get cache entry` | Happy path | Basic caching |
| `should return null for expired entry` | TTL expired | Auto-expiration |
| `should return null for non-existent key` | Cache miss | Miss handling |
| `should delete cache entry` | Manual invalidation | Cache control |
| `should delete entries by prefix` | Bulk invalidation | Pattern-based cleanup |
| `should handle empty prefix results` | No matches | Edge case |

---

## FirestoreRateLimitService

**File:** `tests/firestoreRateLimitService.test.ts`

Distributed rate limiting using Firestore.

### Key Generators

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should generate IP key correctly` | IP-based limiting | Per-IP limits |
| `should generate wallet key with lowercase` | Wallet-based | Per-user limits |
| `should generate API key correctly` | API-based | Per-endpoint limits |
| `should generate global key` | Global limiting | System-wide limits |

### Rate Limit Configuration

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should have global rate limit config` | Config exists | Global limits defined |
| `should have ip/wallet/api configs` | All types | Comprehensive limiting |

### `checkRateLimit` - Enforce Limits

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should allow request when no existing entry` | First request | New window |
| `should allow request when window expired` | Window reset | Fresh start |
| `should block request when limit exceeded` | Over limit | Rate limiting works |
| `should increment count within same window` | Normal usage | Counter tracking |
| `should fail open on NOT_FOUND error` | Collection missing | Graceful degradation |
| `should fail open on other Firestore errors` | Database issues | Availability over strictness |

### `checkMultipleRateLimits` - Batch Check

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return allowed when all limits pass` | Under limits | Request proceeds |
| `should return failed type when one fails` | One over limit | Identifies which limit |

---

## FirestoreChainConfigService

**File:** `tests/firestoreChainConfigService.test.ts`

Manages multi-chain configuration (RPC URLs, contract addresses).

### Chain Config CRUD

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should get chain config by ID` | Lookup | Chain settings |
| `should return null for non-existent chain` | Unknown chain | Graceful handling |
| `should get all chain configs` | List all | Supported chains |
| `should get active chains only` | Filter inactive | Active chains |
| `should set chain config` | Create/update | Admin operations |
| `should delete chain config` | Remove chain | Admin operations |
| `should get config by chain ID number` | Numeric lookup | EVM chain IDs |

---

## FirestoreAlertingService

**File:** `tests/firestoreAlertingService.test.ts`

System alerting and webhook notifications.

### Alert Management

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should create an alert` | New alert | Alert tracking |
| `should get alerts by severity` | Filter by level | Priority handling |
| `should get unresolved alerts` | Active issues | Monitoring |
| `should resolve an alert` | Mark fixed | Alert lifecycle |
| `should get recent alerts` | Dashboard | Overview |

### Webhook Management

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should register a webhook` | New webhook | External notifications |
| `should get webhooks by event type` | Filter | Event routing |
| `should delete a webhook` | Remove | Cleanup |

---

## FirestoreClient

**File:** `tests/firestoreClient.test.ts`

Firestore client initialization and utilities.

### Collections

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should export all collection names` | Constants defined | Consistent naming |
| `should have correct number of collections` | 13 collections | Completeness check |

### Document Helpers

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should convert existing document to object` | Doc exists | Data extraction |
| `should return null for non-existing document` | Doc missing | Null handling |
| `should convert array of documents` | Multiple docs | Batch conversion |
| `should return empty array for empty input` | No docs | Edge case |

### Client Initialization

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should warn when GCP_PROJECT_ID not set` | Missing config | Developer feedback |
| `should use GCP_CREDENTIALS when set` | JSON credentials | Cloud deployment |
| `should handle invalid GCP_CREDENTIALS JSON` | Bad JSON | Error handling |
| `should use GOOGLE_APPLICATION_CREDENTIALS` | File path | Local development |
| `should use default credentials` | GCP environment | Auto-detection |
| `should return cached client (singleton)` | Multiple calls | Performance |

---

## LLMService

**File:** `tests/llmService.test.ts`

Unified LLM service for Claude, GPT, and Gemini with streaming support.

### Constructor / Initialization

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should initialize Claude when API key set` | Key present | Claude available |
| `should not initialize Claude when key missing` | No key | Graceful skip |
| `should detect GPT availability` | OpenAI key | GPT available |
| `should detect Gemini availability` | Google key | Gemini available |

### `getAvailableProviders`

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return list of available providers` | Mixed availability | Runtime detection |
| `should return empty array when none configured` | No keys | No providers |
| `should include all three when available` | All keys | Full support |

### `formatApisAsTools` - Convert APIs to LLM Tools

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should convert APIs to tool definitions` | Normal API | Tool formatting |
| `should handle APIs without fee` | No fee field | Optional fields |
| `should replace dashes with underscores` | Tool naming | Valid identifiers |
| `should use API name as fallback` | Empty description | Fallback handling |

### `streamChat` - Streaming Responses

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should throw for unsupported provider` | Invalid provider | Error handling |
| `should throw when Claude not initialized` | No API key | Clear error |
| `should throw when GPT not configured` | No API key | Clear error |
| `should throw when Gemini not configured` | No API key | Clear error |
| `should stream Claude responses` | Normal streaming | Token-by-token |
| `should stream Claude with tool calls` | Function calling | Tool support |
| `should stream GPT responses` | OpenAI streaming | Token-by-token |
| `should stream Gemini responses` | Google streaming | Token-by-token |
| `should handle Claude API errors` | API failure | Error propagation |
| `should handle GPT API errors` | API failure | Error propagation |
| `should handle Gemini API errors` | API failure | Error propagation |
| `should handle Claude tool calls with empty input` | No arguments | Edge case |
| `should handle GPT with empty choices` | Malformed response | Graceful handling |
| `should handle GPT tool calls with missing fields` | Partial data | Fallback values |

### `chat` - Non-Streaming

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should collect streamed response` | Accumulate tokens | Simple interface |
| `should collect tool calls from stream` | Tool accumulation | Complete response |
| `should set correct stop_reason` | end_turn vs tool_use | Response metadata |

### Gemini Role Mapping

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should map assistant role to model` | Role conversion | Gemini compatibility |

---

## MultiChainPaymentService

**File:** `tests/multiChainPaymentService.test.ts`

Handles payments on both EVM (Thirdweb) and Solana chains.

### Payment Verification

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should verify EVM payment authorization` | Valid signature | x402 protocol |
| `should verify Solana payment authorization` | Valid signature | Solana support |
| `should reject invalid payment data` | Bad input | Security |
| `should handle missing chain config` | Unknown chain | Error handling |

### Payment Execution

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should execute EVM payment transfer` | Thirdweb settlement | On-chain payment |
| `should execute Solana payment transfer` | Solana settlement | On-chain payment |
| `should route to correct chain handler` | Chain detection | Multi-chain routing |
| `should handle EVM settlement failure` | Transaction failed | Error handling |
| `should handle Solana settlement failure` | Transaction failed | Error handling |
| `should handle Solana non-200 status` | API error | HTTP error handling |
| `should handle Thirdweb initialization error` | Client failure | Initialization errors |

### HTTP Method Normalization

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should normalize HTTP methods to uppercase` | Lowercase input | Consistent handling |

---

## CircuitBreaker

**File:** `tests/circuitBreaker.test.ts`

Fault tolerance pattern to prevent cascading failures.

### Circuit States

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should start in CLOSED state` | Initial state | Normal operation |
| `should open circuit after threshold failures` | Too many failures | Stop calling |
| `should transition to HALF_OPEN after timeout` | Recovery attempt | Test the waters |
| `should close circuit on successful call` | Recovery success | Resume normal |
| `should re-open on HALF_OPEN failure` | Recovery failed | Back to open |

### `canCall` - Check Circuit

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should allow calls when CLOSED` | Normal state | Calls proceed |
| `should block calls when OPEN` | Failure state | Fast fail |
| `should allow one call when HALF_OPEN` | Testing | Recovery probe |

### `recordSuccess` / `recordFailure`

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should record successful calls` | Success tracking | Health monitoring |
| `should record failures and track threshold` | Failure tracking | Trip detection |
| `should reset failure count on success` | Recovery | Clean slate |

### `getCircuitStats` - Monitoring

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return circuit statistics` | Monitoring data | Observability |
| `should count circuits by state` | State summary | Dashboard |
| `should count HALF_OPEN circuits` | Recovery tracking | Health overview |

---

## RateLimiter Middleware

**File:** `tests/rateLimiter.test.ts`

Express middleware for rate limiting requests.

### Middleware Configuration

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should create rate limiter middleware` | Factory function | Middleware creation |
| `should use default options` | No options | Sensible defaults |
| `should merge custom options` | Custom config | Flexibility |

### Rate Limiting Logic

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should allow requests under limit` | Normal usage | Requests proceed |
| `should block requests over limit` | Exceeded limit | 429 response |
| `should include rate limit headers` | X-RateLimit-* | Client feedback |
| `should include Retry-After header when blocked` | Over limit | Client guidance |

### Key Extraction

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should extract IP from X-Forwarded-For` | Behind proxy | Real client IP |
| `should extract IP from X-Real-IP` | Nginx proxy | Real client IP |
| `should fallback to socket address` | Direct connection | IP extraction |
| `should extract wallet from header` | X-Wallet-Address | User identification |
| `should extract wallet from query` | ?wallet=0x... | Alternative method |

### Error Handling

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should fail open on rate limit service error` | Service down | Availability |

---

## JWT Authentication

**File:** `tests/jwtAuth.test.ts`

JWT generation and verification for builder endpoint authentication.

### `generateBuilderJWT` - Create Token

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should generate a valid JWT` | Happy path | Token creation |
| `should include required claims` | iss, aud, tokenAddress | Proper claims |
| `should set expiration to 5 minutes` | Short-lived | Security |
| `should use HS256 algorithm` | Algorithm | Standard choice |

### `verifyBuilderJWT` - Validate Token

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should verify a valid token` | Happy path | Token validation |
| `should verify audience when provided` | Audience check | Endpoint binding |
| `should verify without audience when not provided` | Optional audience | Flexibility |
| `should reject expired token` | Token expired | Security |
| `should reject token with wrong secret` | Invalid signature | Security |
| `should reject token with wrong issuer` | Issuer mismatch | Security |
| `should reject token with wrong algorithm` | Algorithm mismatch | Security |

---

## AgentToolService

**File:** `tests/agentToolService.test.ts`

Manages tools available to AI agents.

### Tool Management

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should get tools for agent` | Agent has tools | Tool loading |
| `should return empty array for agent without tools` | No tools | Edge case |
| `should filter tools by availability` | Some disabled | Active tools only |
| `should handle error during tool processing` | Bad data | Error handling |

### Tool Execution

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should execute a tool` | Tool call | Function execution |
| `should handle tool execution errors` | Tool fails | Error handling |
| `should validate tool inputs` | Invalid input | Input validation |

---

## EVM Contract Service

**File:** `tests/evmContractService.test.ts`

Interacts with EVM smart contracts (IAOToken, IAOTokenFactory).

### Contract Reads

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should read token balance` | Balance check | Token queries |
| `should read graduation status` | Progress check | Bonding curve |
| `should handle contract errors` | RPC failure | Error handling |

### Contract Writes

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should execute contract transaction` | Write operation | State changes |
| `should handle transaction failure` | TX reverted | Error handling |

---

## Solana Contract Service

**File:** `tests/solanaContractService.test.ts`

Interacts with Solana programs.

### Solana Operations

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should get token balance` | SPL token balance | Solana tokens |
| `should verify payment signature` | Transaction verify | Payment confirmation |
| `should handle RPC errors` | Network issues | Error handling |
| `should handle invalid addresses` | Bad input | Input validation |

---

## API Routes (x402 & POST Support)

**File:** `tests/apiRoutes.test.ts`

Tests for x402 payment protocol response format and POST method support.

### x402 402 Payment Required Response

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return x402 v2 format with all required fields` | Complete response | Protocol compliance |
| `should include facilitator address in 402 response` | payTo field | Thirdweb integration |
| `should include API metadata in extra field` | Extra data | API discovery |
| `should support multiple payment options` | Multi-chain | Solana + EVM support |
| `should return 402 with verification failure details` | Auth failed | Clear error messages |
| `should return 402 when payment amount insufficient` | Underpaid | Amount validation |

### API Registration with POST Method

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should accept POST as valid HTTP method` | POST allowed | Method support |
| `should normalize HTTP method to uppercase` | 'post' → 'POST' | Consistent handling |
| `should reject invalid HTTP methods` | 'INVALID' rejected | Input validation |
| `should allow same URL with different methods` | GET & POST coexist | RESTful APIs |
| `should default method to GET when not specified` | No method given | Backwards compatibility |

### POST Request Forwarding

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should forward POST request body to builder` | Body passed through | Data integrity |
| `should include authentication header` | X-IAO-Auth present | Builder security |
| `should handle POST with query parameters` | URL + body | Flexible APIs |
| `should preserve Content-Type` | JSON/form data | Correct parsing |

### POST Method in Tool Calls

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should include method in API info` | Method exposed | Agent awareness |
| `should pass tool input as POST body` | Input → body | Correct forwarding |
| `should handle GET vs POST differently` | Query vs body | Method-aware routing |

### Dynamic Route Method Support

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should support GET and POST on same route` | Shared path | RESTful design |
| `should determine method from API config` | Config-driven | Flexibility |
| `should reject mismatched request method` | Wrong method | Security |

### Payment Flow with POST Methods

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should include request body in payment context` | Body available | Audit trail |
| `should settle payment before forwarding` | Pay-then-call | Correct flow |
| `should not settle if POST request fails` | Failure handling | User protection |

---

## Running Tests

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run with coverage
yarn test:coverage

# Run specific test file
yarn test tests/firestoreTokenService.test.ts

# Run tests matching pattern
yarn test --grep "should create"

# View HTML coverage report
open coverage/index.html
```

## CI/CD Integration

Tests run automatically on:
- **GitHub Actions**: Push to main/feat/*/fix/*/develop branches, PRs to main/develop
- **Google Cloud Build**: Before deployment to Cloud Run

See `.github/workflows/ci.yml` and `cloudbuild.yaml` for configuration.
