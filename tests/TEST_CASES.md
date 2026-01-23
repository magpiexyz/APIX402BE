# Test Cases Explained

This document describes what each test case does and why it matters.

---

## FirestoreTokenService

**File:** `tests/firestoreTokenService.test.ts`

### `getItemBySlug`

Looks up a registered server by its URL slug. Used when routing API requests like `/api/magpie/get-price`.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return a token when slug exists` | Happy path - server found | Core functionality for API routing |
| `should return null when slug does not exist` | Server not registered | Returns 404 to user instead of crashing |
| `should normalize slug to lowercase` | User types `MAGPIE` instead of `magpie` | Case-insensitive lookups prevent errors |

### `slugExists`

Checks if a server slug is already taken. Used during server registration.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return true when slug exists` | Slug already taken | Prevents duplicate registrations |
| `should return false when slug does not exist` | Slug available | Allows new registration to proceed |

### `getApiBySlug`

Finds a specific API endpoint within a registered server.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return API entry when it exists in token` | Happy path | Routes to correct builder endpoint |
| `should return null when API slug does not exist` | API not found | Returns 404 for unknown API |
| `should normalize API slug to lowercase` | Case-insensitive | `/api/server/GET-DATA` works like `/api/server/get-data` |
| `should return null for token with no APIs` | Edge case - empty APIs | Handles newly registered servers gracefully |

### `getApiByIndex`

Finds an API endpoint by its numeric index instead of slug.

| Test | Scenario | Why It Matters |
|------|----------|----------------|
| `should return API entry by index` | Index 0 returns first API | Supports index-based routing |
| `should return null for invalid index` | Index 999 doesn't exist | Prevents array out-of-bounds errors |
