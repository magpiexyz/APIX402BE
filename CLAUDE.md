# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Rules

- **Always ask before pushing** - Never push to any git repository without explicit user approval. Commit locally, then ask before pushing.
- **NEVER work in /home/error0180/iaodeployment** - That folder is a stale fork. ALL backend work MUST be done in `/home/error0180/APIX402BE`. ALL frontend work MUST be done in `/home/error0180/APIX402FE`. If your working directory is set to iaodeployment, STOP and switch to APIX402BE before making any changes.

## Project Overview

APIX (IAO - Initial API Offering) is a decentralized API marketplace that enables developers to monetize their APIs through a bonding curve token model. The system consists of three main components across separate repositories:

- **Backend (this repo)**: Express.js proxy server that handles payment verification and request forwarding
- **Frontend**: `/home/error0180/APIX402FE` - React/Vite application for API marketplace UI
- **Smart Contracts**: `/home/error0180/hyperpie/contracts/IAO` - Solidity contracts for IAO token creation and bonding curve

### How It Works

1. **API Server Registration**: Developers register their APIs through the frontend, which creates an IAO token via smart contract
2. **Payment Flow (x402 Protocol)**: Users pay for API access using EIP-3009 payment authorization (signed off-chain, settled on-chain)
3. **Token Distribution**: Successful API calls trigger token minting following a bonding curve until graduation threshold
4. **Graduation**: When threshold is reached, liquidity deploys to Uniswap V4 for token trading

## Development Commands

### Backend (Express.js)
```bash
# Development server (uses tsx for TypeScript execution)
yarn dev

# Build TypeScript to JavaScript
yarn build

# Production server (runs compiled JS)
yarn start
```

### Frontend (React/Vite)
```bash
cd /home/error0180/APIX402FE

# Development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Smart Contracts (Foundry)
```bash
cd /home/error0180/hyperpie

# Build contracts
forge build

# Run tests
forge test

# Test with gas report
forge test --gas-report

# Deploy to testnet
make deploy-lrt-testnet
```

## Architecture

### Backend Proxy Flow (src/index.ts)

The proxy implements a "pay-after-success" model:

1. **Request arrives** at `/api/:serverSlug/:apiSlug`
2. **Lookup server** from Firestore by slug
3. **Verify payment authorization** (without settling) using `verifyPaymentAuthorization()`
4. **Forward to builder endpoint** - Call actual API first
5. **Settle payment** only if builder returns 2xx status via `executePaymentTransfer()`
6. **Update metrics** in Firestore
7. **Return response** to user with payment confirmation

Key principle: Users are only charged if the API successfully returns data.

### Payment Protocol (x402 V2)

- Uses EIP-3009 `transferWithAuthorization` for gasless payments
- Payment data sent in `PAYMENT-SIGNATURE` header (base64-encoded JSON)
- Thirdweb facilitator handles on-chain settlement
- Users sign payment to facilitator address, which forwards to token address

### Database Schema (Firestore)

**Collection: `iao-tokens`** - Token metadata
- `id`: Token address (lowercase)
- `slug`: Server slug (e.g., "magpie")
- `apis[]`: Array of API endpoints with fees
- `subscriptionCount`: Total API calls across all APIs
- `chainId`: Blockchain network ID

**Collection: `user-requests`** - User call history
- Document ID: `{tokenAddress}_{userAddress}_{requestNumber}`
- `iaoToken`: Token address for querying
- `userAddress`: Caller's wallet address
- `timestamp`: Request timestamp

**Collection: `request-queue`** - Pending request queue
- Document ID: `{tokenAddress}_{userAddress}_{requestNumber}`
- Used for automation to mint tokens after successful payments

**Collection: `api-metrics`** - API performance metrics
- Document ID: `{tokenAddress}_{apiSlug}`
- Tracks success/failure rates, latency, revenue

**Collection: `agents`** - AI agent configurations
- Agent metadata and settings

**Collection: `chat-sessions`** - Chat session tracking
- Session metadata for agent interactions

**Collection: `chat-messages`** - Chat message history
- Individual messages within sessions

**Collection: `agent-payments`** - Agent payment records
- Payment tracking for agent usage

**Collection: `cache`** - General caching layer
- Short-lived cached data

**Collection: `rate-limits`** - Rate limiting data
- Per-user and per-API rate limit tracking

**Collection: `chain-configs`** - Multi-chain configurations
- Network-specific settings (RPC URLs, contract addresses)

**Collection: `alerts`** - System alerting
- Alert configurations and history

**Collection: `webhooks`** - Webhook configurations
- External notification endpoints

### Smart Contract Architecture

**IAOTokenFactory.sol** (`0x5a40F7f30b25D07aB1C06dEB7400554Bc20f8ad4` on Base Sepolia)
- Creates IAO tokens via minimal proxy clones
- Manages payment token configurations (price, decimals, graduation threshold)
- One token per server slug

**IAOToken.sol** (ERC20 + bonding curve)
- Distributes tokens on successful API payments via `receiveWithAuthorization()`
- Tracks `graduationThreshold` (62.5% of 1B tokens = 625M)
- Deploys Uniswap V4 liquidity on graduation via `deployLiquidity()`
- Uses LpGuardHook to prevent early liquidity removal

### Frontend Structure

- **Pages**: MarketplacePage, APIDetailsPage, OverviewPage (metrics), SubmitAPIForm, Dashboard
- **Hooks**: `useX402Payment.ts` - Handles EIP-3009 payment signing
- **API Client**: `utils/api.ts` - Calls backend endpoints
- **Thirdweb Integration**: Web3 wallet connection and transaction signing

## Environment Variables

### Backend (.env)
```bash
# GCP Configuration (required for Firestore)
GCP_PROJECT_ID=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
# Or use GCP_CREDENTIALS for inline JSON credentials

# Thirdweb x402 facilitator (required for payments)
THIRDWEB_SECRET_KEY=sk_...
THIRDWEB_SERVER_WALLET_ADDRESS=0x...

# JWT authentication for builder endpoints
BUILDER_SECRET_PHRASE=your-shared-secret

# Server configuration
PORT=3000
NODE_ENV=development
```

### Frontend (.env)
```bash
VITE_THIRDWEB_CLIENT_ID=...
VITE_API_BASE_URL=http://localhost:3000
```

### Smart Contracts (.env)
```bash
PRIVATE_KEY=0x...
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
ETHERSCAN_API_KEY=...
```

## Key Files

### Backend
- `src/index.ts` - Main Express server with all API routes
- `src/db/firestoreClient.ts` - Firestore database client initialization
- `src/services/firestoreTokenService.ts` - Token CRUD operations
- `src/services/firestoreUserRequestService.ts` - Request queue and user history
- `src/services/firestoreMetricsService.ts` - API call metrics tracking
- `src/services/firestoreAgentService.ts` - AI agent management
- `src/services/firestoreChatSessionService.ts` - Chat session management
- `src/services/firestoreAgentPaymentService.ts` - Agent payment tracking
- `src/services/firestoreCacheService.ts` - Caching layer
- `src/services/firestoreRateLimitService.ts` - Rate limiting
- `src/services/firestoreChainConfigService.ts` - Multi-chain configuration
- `src/services/firestoreAlertingService.ts` - Alerting system
- `src/middleware/rateLimiter.ts` - Rate limiting middleware
- `src/services/circuitBreaker.ts` - Circuit breaker for fault tolerance
- `src/utils/jwtAuth.ts` - JWT generation for builder authentication
- `abis/IAOToken.json` - ABI for reading on-chain token state
- `abis/IAOTokenFactory.json` - ABI for factory contract

### Frontend
- `src/pages/SubmitAPIForm.tsx` - Server and API registration form
- `src/hooks/useX402Payment.ts` - Payment authorization signing logic
- `src/utils/api.ts` - Backend API client
- `src/contracts/tokenFactory.ts` - Smart contract interaction helpers

### Smart Contracts
- `contracts/IAO/IAOToken.sol` - Main token contract with bonding curve
- `contracts/IAO/IAOTokenFactory.sol` - Token creation factory
- `contracts/IAO/LpGuardHook.sol` - Uniswap V4 hook to prevent early LP removal
- `contracts/IAO/interfaces/` - Contract interfaces

## Important Implementation Details

### Server Registration Flow
1. Frontend calls `POST /api/register` with `tokenAddress` missing (validation mode)
2. Backend validates slug availability, API URLs are reachable (200 status), no duplicates
3. Frontend creates token via `IAOTokenFactory.createToken()`
4. Frontend calls `POST /api/register` again with `tokenAddress` (registration mode)
5. Backend stores token metadata in Firestore

### Payment Authorization (x402 V2)
- Payment signature must be to **facilitator address**, not token address
- Backend uses `verifyPaymentAuthorization()` to check signature validity
- After builder success, `executePaymentTransfer()` calls `settlePayment()` from thirdweb
- The facilitator forwards payment to the token address

### Builder Authentication
- Proxy generates JWT with `generateBuilderJWT()` and sends in `X-IAO-Auth` header
- Builders verify JWT using shared `BUILDER_SECRET_PHRASE`
- JWT contains: `iss: "iao-proxy"`, `aud: <endpoint>`, `tokenAddress`, `exp: 5min`

### Bonding Curve Logic (Smart Contract)
- Payment settled → `receiveWithAuthorization()` called on IAOToken
- Token amount calculated: `(fee * paymentTokenPrice) / (10^paymentTokenDecimals)`
- Tokens minted to payer's address
- Progress tracked: `totalTokensDistributed / graduationThreshold`
- At 100%: `deployLiquidity()` creates Uniswap V4 pool with LpGuardHook

## Testing & Debugging

### Firestore Emulator (Local Development)
```bash
# Start Firebase emulator suite
firebase emulators:start

# Emulator UI available at http://localhost:4000
# Firestore emulator runs on http://localhost:8080
```

### Firestore Console (Production)
Access the [Firebase Console](https://console.firebase.google.com) to:
- Browse collections and documents
- Run queries
- Monitor usage and performance

### Test API Endpoints
```bash
# Get all servers
curl http://localhost:3000/api/servers | jq

# Get server metadata
curl http://localhost:3000/api/server/magpie | jq

# Get server metrics (includes bonding progress)
curl http://localhost:3000/api/metrics/magpie | jq
```

### Common Issues

**"Builder endpoint validation failed"**: The API URL must return 200 status on GET request during registration

**"Payment recipient mismatch"**: User signed payment to wrong address - must be facilitator address, not token address

**"Thirdweb credentials not found"**: Set `THIRDWEB_SECRET_KEY` and `THIRDWEB_SERVER_WALLET_ADDRESS` in backend .env

**"Server slug already taken"**: Slug must be unique globally - each slug maps to one IAO token

**"Firestore permission denied"**: Check that `GOOGLE_APPLICATION_CREDENTIALS` points to valid service account JSON

## GCP Deployment

### Backend (Cloud Run)
```bash
# Build and deploy to Cloud Run
gcloud run deploy apix-backend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=your-project"

# View logs
gcloud run services logs read apix-backend --region us-central1
```

### Frontend (Firebase Hosting)
```bash
cd /home/error0180/APIX402FE

# Build production bundle
npm run build

# Deploy to Firebase Hosting
firebase deploy --only hosting
```

### CI/CD with Cloud Build
- Push to `main` branch triggers automatic deployment
- Cloud Build configuration in `cloudbuild.yaml`
- Secrets managed via Secret Manager

## Contract Addresses (Base Sepolia)

- **IAOTokenFactory**: `0x5a40F7f30b25D07aB1C06dEB7400554Bc20f8ad4`
- **USDC (Mock)**: Check `paymentTokenInfo` mapping in factory

## Documentation References

- Architecture Overview: `docs/ARCHITECTURE.md`
- GCP Deployment Guide: `docs/GCP_DEPLOYMENT.md`
- Firestore Schema: `docs/FIRESTORE_SCHEMA.md`
- Builder JWT Authentication: `BUILDER_JWT_AUTH.md`
- Thirdweb Facilitator Setup: `THIRDWEB_SETUP.md`
