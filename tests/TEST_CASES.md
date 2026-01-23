# Test Cases Explained

This document describes what each test case does and why it matters.

**Total Tests: 56**
**Coverage: 100% statements, 93% branches, 100% functions**

---

## FirestoreTokenService

**File:** `tests/firestoreTokenService.test.ts`

### `putItem` - Create/Update Token

Stores a token document in Firestore.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should store a token successfully` | Happy path - new token saved | Core create operation |
| `should overwrite existing token with same id` | Update existing token | Allows token metadata updates |
| `should throw error on Firestore failure` | Database error | Ensures errors propagate correctly |

### `getItem` - Get Token by ID

Retrieves a token by its contract address.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return token when it exists` | Happy path - token found | Core read operation |
| `should return null when token does not exist` | Token not in database | Returns null instead of crashing |
| `should normalize EVM address to lowercase` | Query with `0xABCD...` | Case-insensitive EVM lookups |
| `should preserve Solana address case` | Query with `SoLaNa...` | Solana addresses are case-sensitive |
| `should return null on Firestore error` | Database error | Graceful error handling |

### `deleteItem` - Delete Token

Removes a token from Firestore.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should delete an existing token` | Happy path - token removed | Core delete operation |
| `should normalize EVM address for deletion` | Delete with uppercase address | Case-insensitive deletion |
| `should not throw when deleting non-existent token` | Token doesn't exist | Idempotent delete operation |
| `should throw error on Firestore failure` | Database error | Ensures errors propagate |

### `scanAllItems` - Get All Tokens

Returns all registered tokens.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return all tokens` | Multiple tokens exist | List all servers for marketplace |
| `should return empty array when no tokens exist` | Database is empty | Returns empty array, not null |
| `should throw error on Firestore failure` | Database error | Ensures errors propagate |

### `scanItemsByBuilder` - Get Tokens by Builder

Returns all tokens owned by a specific builder address.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return tokens for a specific builder` | Builder has tokens | Dashboard shows builder's servers |
| `should return empty array when builder has no tokens` | New builder | Returns empty array, not null |
| `should normalize builder address to lowercase for EVM` | Query with uppercase | Case-insensitive builder lookup |
| `should throw error on Firestore failure` | Database error | Ensures errors propagate |

### `getItemBySlug` - Get Token by URL Slug

Looks up a token by its URL slug (e.g., "magpie").

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return a token when slug exists` | Happy path - server found | Core routing - `/api/magpie/...` |
| `should return null when slug does not exist` | Server not registered | Returns 404 to user |
| `should normalize slug to lowercase` | Query with `MAGPIE` | Case-insensitive URL routing |
| `should return null on Firestore error` | Database error | Graceful error handling |

### `slugExists` - Check Slug Availability

Checks if a server slug is already taken.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return true when slug exists` | Slug already taken | Prevents duplicate registrations |
| `should return false when slug does not exist` | Slug available | Allows new registration |

### `apiUrlExists` - Check API URL Uniqueness

Checks if an API URL + method combination is already registered.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return exists: true when URL and method match` | Duplicate found | Prevents duplicate API endpoints |
| `should return exists: false when URL exists but method differs` | Same URL, different method | GET and POST to same URL is allowed |
| `should return exists: false when URL does not exist` | New URL | Allows new API registration |
| `should default method to GET when not specified` | Legacy API entry | Backwards compatibility |
| `should return exists: false on error` | Database error | Graceful degradation |
| `should handle tokens with no apis array` | Edge case - empty token | Handles missing arrays |

### `checkApiUrlsDuplicate` - Batch URL Duplicate Check

Checks multiple API URLs for duplicates in a single call.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return duplicates when URLs and methods match` | Found duplicates | Validates bulk registration |
| `should return empty array when no duplicates exist` | All unique | Allows registration to proceed |
| `should allow same URL with different method` | GET vs POST | Different methods are distinct |
| `should check multiple APIs at once` | Batch check | Efficient validation |
| `should return empty array on error` | Database error | Graceful degradation |

### `addApiToToken` - Add New API to Existing Token

Adds a new API endpoint to an existing server.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should add a new API to existing token` | Happy path | Core API registration |
| `should return null when token does not exist` | Invalid token | Validates token exists |
| `should return null when API slug already exists in token` | Duplicate slug | Prevents duplicate API slugs |
| `should normalize API slug to lowercase` | Slug with uppercase | Consistent slug format |
| `should default method to GET` | No method specified | Sensible default |
| `should initialize apis array if undefined` | New token | Handles missing array |
| `should set createdAt timestamp` | Timestamp check | Audit trail |

### `getApiBySlug` - Find API by Slug

Finds a specific API endpoint within a token.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return API entry when it exists in token` | Happy path | Routes to correct endpoint |
| `should return null when API slug does not exist` | API not found | Returns 404 |
| `should normalize API slug to lowercase` | Uppercase query | Case-insensitive routing |
| `should return null for token with empty apis array` | No APIs | Handles empty arrays |
| `should return null for token with undefined apis` | Missing array | Handles undefined |

### `getApiByIndex` - Find API by Index

Finds an API endpoint by its numeric index.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return API entry by index` | Happy path | Index-based lookup |
| `should return null for invalid index` | Out of bounds | Prevents array errors |
| `should return null for negative index` | Negative number | Input validation |
| `should return null for token with empty apis array` | No APIs | Handles empty arrays |
| `should return null for token with undefined apis` | Missing array | Handles undefined |
| `should find correct API when multiple exist` | Multiple APIs | Correct index selection |

### Address Normalization

Tests for multi-chain address handling.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should lowercase EVM addresses (0x prefix)` | EVM address | Case-insensitive EVM |
| `should preserve Solana address case (no 0x prefix)` | Solana address | Case-sensitive Solana |

---

## Running Tests

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run with coverage
yarn test:coverage

# View HTML coverage report
open coverage/index.html
```
