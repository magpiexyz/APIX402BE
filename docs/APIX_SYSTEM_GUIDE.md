# APIX (IAO) System Guide

A comprehensive guide covering Cloud Function scheduling, smart contract architecture & deployment, and the token generation mechanism.

---

## Table of Contents

1. [Cloud Function & Scheduler Setup](#1-cloud-function--scheduler-setup)
2. [Smart Contract Source Code & Deployment](#2-smart-contract-source-code--deployment)
3. [API Token Generation Mechanism](#3-api-token-generation-mechanism)

---

## 1. Cloud Function & Scheduler Setup

### Overview

APIX uses **Google Cloud Scheduler** and **Cloud Tasks** to automate two main operations:

| Operation | Trigger | Frequency | Purpose |
|-----------|---------|-----------|---------|
| Fee Distribution | Cloud Scheduler | Weekly (Sunday midnight UTC) | Distribute accumulated USDC fees to builders/team |
| Token Graduation | Cloud Tasks | On-demand (threshold crossed) | Deploy Merkle root + liquidity on-chain |

### Architecture Diagram

```
                     Cloud Scheduler (weekly cron)
                              │
                              ▼
              POST /internal/trigger-fee-distribution
              (Backend on Cloud Run)
                    │                │
                    ▼                ▼
        fee-distribution-evm   fee-distribution-solana
        (Cloud Function)       (Cloud Function)
                    │                │
                    ▼                ▼
            On-chain TX          On-chain TX
                    │                │
                    ▼                ▼
        POST /internal/fee-distribution-confirm
        (Backend clears pending fees)
```

```
        API call triggers graduation threshold
                        │
                        ▼
            Cloud Tasks Queue (dedup by task name)
                        │
                        ▼
            POST /internal/graduate/:tokenAddress
            (Backend builds Merkle tree)
                    │                │
                    ▼                ▼
            graduation-evm     graduation-solana
            (Cloud Function)   (Cloud Function)
                    │                │
                    ▼                ▼
            POST /internal/graduation-confirm/:tokenAddress
            (Backend marks graduated=true)
```

### Cloud Functions (4 total)

All source code is in `/cloud-functions/`:

#### 1. Fee Distribution EVM
- **Path**: `cloud-functions/fee-distribution-evm/src/index.ts`
- **Function**: `distributeFeesEvm`
- **Trigger**: HTTP POST from Cloud Scheduler
- **What it does**: Calls `TokenDistributor.distributeFees()` on-chain to split accumulated USDC among builders and team
- **Required env vars**:
  - `AUTOMATION_PRIVATE_KEY` — Hex private key for signing transactions
  - `RPC_URL` — Base Sepolia RPC endpoint
  - `TOKEN_DISTRIBUTOR` — TokenDistributor contract address
  - `BACKEND_URL` — Backend Cloud Run URL
  - `FEE_DISTRIBUTION_SECRET` — Shared secret for auth

#### 2. Fee Distribution Solana
- **Path**: `cloud-functions/fee-distribution-solana/src/index.ts`
- **Function**: `distributeFeesSolana`
- **Trigger**: HTTP POST from Cloud Scheduler
- **What it does**: Calls `distribute_fees` instruction per token on Solana
- **Required env vars**:
  - `AUTOMATION_PRIVATE_KEY` — Base58-encoded Solana keypair
  - `SOLANA_RPC_URL` — Solana Devnet RPC
  - `IAO_PROGRAM_ID` — `FpCX6E1LxRph23NJgF9R8haRJscGPbbdhP2vd5Sn6jwA`
  - `BACKEND_URL`, `FEE_DISTRIBUTION_SECRET`

#### 3. Graduation EVM
- **Path**: `cloud-functions/graduation-evm/src/index.ts`
- **Function**: `graduateEvm`
- **Trigger**: HTTP POST from Cloud Tasks
- **What it does**: Calls `TokenDistributor.graduateTokenWithMerkle()` with Merkle root, then auto-distributes fees. Uses 25M gas limit (Uniswap V4 pool init needs ~20M).
- **Required env vars**: `AUTOMATION_PRIVATE_KEY`, `RPC_URL`, `TOKEN_DISTRIBUTOR`, `BACKEND_URL`, `GRADUATION_INTERNAL_SECRET`

#### 4. Graduation Solana
- **Path**: `cloud-functions/graduation-solana/src/index.ts`
- **Function**: `graduateSolana`
- **Trigger**: HTTP POST from Cloud Tasks
- **What it does**: Two-step: `graduate_with_merkle()` then `distribute_fees()`. Uses Borsh encoding for Merkle root.
- **Required env vars**: `AUTOMATION_PRIVATE_KEY` (base58), `SOLANA_RPC_URL`, `IAO_PROGRAM_ID`, `BACKEND_URL`, `GRADUATION_INTERNAL_SECRET`

### Setup Steps

#### Step 1: Deploy Cloud Functions

```bash
# From /home/error0180/APIX402BE

# Deploy graduation functions
./deploy-cloud-functions.sh

# Or manually:
cd cloud-functions/graduation-evm
gcloud functions deploy graduateEvm \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --trigger-http \
  --allow-unauthenticated \
  --set-secrets="AUTOMATION_PRIVATE_KEY=automation-private-key:latest" \
  --set-env-vars="RPC_URL=https://sepolia.base.org,TOKEN_DISTRIBUTOR=0x...,BACKEND_URL=https://your-backend.run.app,GRADUATION_INTERNAL_SECRET=your-secret"

# Repeat for graduation-solana, fee-distribution-evm, fee-distribution-solana
```

#### Step 2: Create Cloud Tasks Queue

```bash
gcloud tasks queues create graduation-queue \
  --location=us-central1

# Verify queue exists
gcloud tasks queues list --location=us-central1
```

#### Step 3: Set Up Cloud Scheduler

```bash
# Weekly fee distribution - runs every Sunday at midnight UTC
gcloud scheduler jobs create http fee-distribution-weekly \
  --schedule="0 0 * * 0" \
  --uri="https://your-backend.run.app/internal/trigger-fee-distribution" \
  --http-method=POST \
  --headers="Content-Type=application/json,X-Fee-Distribution-Secret=YOUR_SECRET" \
  --time-zone="UTC" \
  --description="Weekly fee distribution trigger"
```

#### Step 4: Configure Backend Environment

Add these to Cloud Run environment:

```bash
# Cloud Tasks
GRADUATION_QUEUE_NAME=graduation-queue
GRADUATION_QUEUE_LOCATION=us-central1

# Cloud Function URLs (obtained after deploying functions)
GRADUATION_FUNCTION_EVM_URL=https://graduateevm-xxxxx.run.app
GRADUATION_FUNCTION_SOLANA_URL=https://graduatesolana-xxxxx.run.app
FEE_DISTRIBUTION_EVM_URL=https://distributefeesevm-xxxxx.run.app
FEE_DISTRIBUTION_SOLANA_URL=https://distributefeessolana-xxxxx.run.app

# Shared secrets
GRADUATION_INTERNAL_SECRET=your-graduation-secret
FEE_DISTRIBUTION_SECRET=your-fee-distribution-secret
```

#### Step 5: Full Deployment Script

The all-in-one script handles everything:

```bash
./deploy-gcp.sh
```

This creates the Cloud Tasks queue, deploys all Cloud Functions, and configures Cloud Scheduler.

### Backend Internal Endpoints

| Endpoint | Trigger | Auth Header | Purpose |
|----------|---------|-------------|---------|
| `POST /internal/trigger-fee-distribution` | Cloud Scheduler (weekly) | `X-Fee-Distribution-Secret` | Fetch all tokens, group by chain, call fee distribution functions |
| `POST /internal/graduate/:tokenAddress` | Cloud Tasks (on-demand) | `X-Graduation-Secret` | Build Merkle tree, invoke graduation Cloud Function |
| `POST /internal/graduation-confirm/:tokenAddress` | Cloud Function callback | `X-Graduation-Secret` | Mark token as graduated in Firestore |
| `POST /internal/fee-distribution-confirm` | Cloud Function callback | `X-Fee-Distribution-Secret` | Clear pending fees for processed tokens |
| `GET /internal/graduation-earnings/:tokenAddress` | Solana Cloud Function | `X-Graduation-Secret` | Return earnings breakdown for batch mint |

### Race Condition Protection (3 Layers)

1. **Cloud Tasks deduplication**: Named task `graduate-{tokenAddress}` — duplicate dispatch returns gRPC ALREADY_EXISTS (silently ignored)
2. **Firestore atomic transaction**: `incrementVirtualDistributedWithEarnings()` — single transaction caps distribution at threshold
3. **Graduation lock**: Firestore document with 5-minute TTL — prevents concurrent graduation execution

---

## 2. Smart Contract Source Code & Deployment

### Source Code Locations

#### EVM Contracts (Solidity)
**Root**: `/home/error0180/hyperpie/contracts/IAO/`

| File | Purpose |
|------|---------|
| `IAOToken.sol` | ERC20 token with bonding curve, EIP-3009 payments, Uniswap V4 liquidity deployment |
| `IAOTokenV2.sol` | Optimized version (under 24KB limit) — delegates liquidity to external helper |
| `IAOTokenFactory.sol` | Factory that creates tokens via minimal proxy clones, manages payment token configs |
| `TokenDistributor.sol` | Batch distributes tokens across users/tokens. Idempotent via txHash tracking. ~$0.01-0.02/user |
| `LpGuardHook.sol` | Uniswap V4 hook that whitelists pool initializer, prevents unauthorized pool creation |
| `LpGuardHookDeployer.sol` | Mines valid hook addresses (BEFORE_INITIALIZE_FLAG), caches deployed hooks |
| `IAOLiquidityHelper.sol` | External helper for Uniswap V4 pool creation + liquidity provision (extracted for size) |
| `interfaces/IIAOToken.sol` | Token interface: batch transfer, liquidity deployment, Merkle claims |
| `interfaces/IIAOTokenFactory.sol` | Factory interface: CreateTokenParams, PaymentTokenInfo |
| `interfaces/ITokenDistributor.sol` | Distributor interface: batch distribute, graduate, fee distribute |

**Tests**: `/home/error0180/hyperpie/contracts/IAO/tests/`
- `IAOToken.t.sol` — Core token tests
- `IAOTokenFactory.t.sol` — Factory tests
- `IAOTokenMerkleClaim.t.sol` — Merkle claim tests

**Deployment Scripts**: `/home/error0180/hyperpie/contracts/IAO/scripts/` and `/home/error0180/hyperpie/scripts/`
- `deployIAOV2.s.sol` — Main deployment: ProxyAdmin, HyperpieConfig, Factory, TokenV2, Distributor, HookDeployer, LiquidityHelper
- `deployDistributor.s.sol` — Deploy TokenDistributor standalone
- `deployHelper.s.sol` — Deploy IAOLiquidityHelper standalone
- `deployCachedHook.s.sol` — Deploy pre-mined hook
- `manualGraduate.s.sol` — Manual graduation script

#### Solana Program (Rust/Anchor)
**Root**: `/home/error0180/hyperpie/contracts/IAO/solana-program/`

| File/Folder | Purpose |
|-------------|---------|
| `programs/iao-factory/src/lib.rs` | Main program entry point |
| `programs/iao-factory/src/instructions/` | All 10 instructions |
| `programs/iao-factory/src/state/` | Account state definitions |
| `Anchor.toml` | Anchor configuration (program ID, cluster) |
| `README.md` | Comprehensive deployment & usage guide |

**Program ID**: `FpCX6E1LxRph23NJgF9R8haRJscGPbbdhP2vd5Sn6jwA`

**10 Instructions**:
1. `initialize_factory` — One-time factory setup (admin, payment token, price)
2. `create_token` — Create SPL token with bonding curve state (PDA: `["iao-token", slug]`)
3. `initialize_token_vault` — Initialize USDC vault for token (call right after `create_token`)
4. `deploy_liquidity` — Deploy to Raydium CLMM on graduation
5. `update_automation_wallet` — Change automation wallet (admin only)
6. `update_payment_token_price` — Adjust pricing (admin only)
7. `initialize_fee_config` — Set up fee split configuration
8. `distribute_fees` — Distribute accumulated fees to stakeholders
9. `graduate_with_merkle` — Set Merkle root for post-graduation claims
10. `merkle_claim` — Users claim earned tokens via Merkle proof

**Key State Accounts**:
- **FactoryState** (PDA: `["factory"]`) — admin, automation_wallet, payment_token_mint, price, total_tokens_created
- **IaoTokenState** (PDA: `["iao-token", slug]`) — slug, mint, graduation_threshold (625M), total_distributed, is_graduated

### Deployment Guide

#### EVM (Base Sepolia) — Foundry

**Prerequisites**:
```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Configuration
cd /home/error0180/hyperpie
cp .env.example .env
# Edit .env with:
#   PRIVATE_KEY=0x...
#   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
#   ETHERSCAN_API_KEY=...
```

**Build & Test**:
```bash
cd /home/error0180/hyperpie

# Build all contracts
forge build

# Run tests
forge test

# Test with gas report
forge test --gas-report

# Test verbose (show traces)
forge test -vvv
```

**Deploy**:
```bash
# Full V2 deployment (Factory + Token + Distributor + Hook + Helper)
forge script contracts/IAO/scripts/deployIAOV2.s.sol:DeployIAOV2 \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify

# Deploy only TokenDistributor
forge script scripts/deployDistributor.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

**Key Config** (`foundry.toml`):
```toml
evm_version = "cancun"    # Required for Uniswap V4 (tload/tstore)
via_ir = true             # Avoid "stack too deep" errors
optimizer_runs = 10_000
```

**Deployed Addresses (Base Sepolia)**:
| Contract | Address |
|----------|---------|
| IAOTokenFactory | `0x5a40F7f30b25D07aB1C06dEB7400554Bc20f8ad4` |
| USDC (Mock) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Pool Manager (Uniswap V4) | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |
| Position Manager | `0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

#### Solana (Devnet) — Anchor

**Prerequisites**:
```bash
# Install Solana CLI + Anchor
sh -c "$(curl -sSfL https://release.solana.com/v1.17.0/install)"
cargo install --git https://github.com/coral-xyz/anchor --tag v0.29.0 anchor-cli

# Set to devnet
solana config set --url devnet

# Create/fund deploy wallet
solana-keygen new -o ~/.config/solana/deploy-wallet.json
solana airdrop 5 ~/.config/solana/deploy-wallet.json
```

**Build & Test**:
```bash
cd /home/error0180/hyperpie/contracts/IAO/solana-program

# Build program
anchor build
# Note: "IDL doesn't exist" error is non-blocking, .so is still generated

# Run tests
anchor test

# Test on specific cluster
anchor test --provider.cluster devnet
```

**Deploy**:
```bash
cd /home/error0180/hyperpie/contracts/IAO/solana-program

# Deploy to devnet
anchor deploy --provider.cluster devnet \
  --provider.wallet ~/.config/solana/deploy-wallet.json

# Or use solana CLI directly
solana program deploy \
  target/deploy/iao_factory.so \
  --keypair ~/.config/solana/deploy-wallet.json \
  --url devnet
```

**Important Notes**:
- Anchor 0.29 with CLI 0.32.1 — version mismatch warnings are safe to ignore
- Solana BPF has **4KB stack limit per frame** — instructions with many `init` accounts must be split
- `spl_token_2022` stack overflow warnings come from the dependency, not our code
- Solana addresses are **base58 and case-sensitive** — never call `.toLowerCase()` on them

### Contract Architecture Summary

```
EVM:
  IAOTokenFactory ──creates──▶ IAOTokenV2 (minimal proxy clone)
        │                           │
        │                    ┌──────┴──────┐
        │                    │             │
        │              EIP-3009 pay   Graduate
        │              (settle USDC)   (threshold met)
        │                    │             │
        │                    ▼             ▼
        │            Fee accumulation   IAOLiquidityHelper
        │                    │         (Uniswap V4 pool)
        │                    │              │
        │                    ▼              ▼
        │            TokenDistributor   LpGuardHook
        │            (batch distribute)  (protect LP)
        │            (fee distribute)
        │            (graduate w/ merkle)

Solana:
  iao-factory program
        │
  ┌─────┼─────────────┐
  │     │              │
  initialize  create_token  graduate_with_merkle
  _factory    + init_vault   │
                │            │
                │      deploy_liquidity
          PDA state    (Raydium CLMM)
          tracking          │
                │      distribute_fees
          merkle_claim  (weekly)
          (user claims)
```

---

## 3. API Token Generation Mechanism

### Overview

APIX implements a **bonding curve token model** where API usage generates tokens for callers. Tokens are tracked **virtually off-chain** (in Firestore) during the bonding phase, then distributed **on-chain via Merkle proofs** at graduation.

### Token Lifecycle

```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐     ┌──────────────┐
│  1. CREATE   │────▶│  2. BONDING   │────▶│ 3. GRADUATE  │────▶│  4. CLAIM    │
│  (register)  │     │ (API calls    │     │ (Merkle tree │     │ (on-chain    │
│              │     │  earn tokens) │     │  + liquidity)│     │  redemption) │
└──────────────┘     └───────────────┘     └──────────────┘     └──────────────┘
```

### Phase 1: Token Creation (Registration)

**Two-step registration flow**:

**Step 1 — Validation** (`POST /api/register` without `tokenAddress`):
- Backend validates slug uniqueness, API reachability (200 status), no duplicates
- Returns validation result (no data stored)

**Step 2 — On-chain + Registration** (`POST /api/register` with `tokenAddress`):
1. Frontend calls `IAOTokenFactory.createToken()` on-chain (EVM) or `create_token` instruction (Solana)
2. Smart contract creates new ERC20/SPL token with bonding curve state
3. Frontend sends token address to backend
4. Backend stores `IAOTokenDBEntry` in Firestore:

```json
{
  "id": "0xTokenAddress",
  "slug": "my-api-server",
  "name": "My API Token",
  "symbol": "MYAPI",
  "chainId": "84532",
  "builder": "0xBuilderAddress",
  "paymentToken": "0xUSDC",
  "apis": [
    { "slug": "chat", "apiUrl": "https://api.example.com/chat", "fee": "10000", "method": "POST" }
  ],
  "virtualTokensDistributed": "0",
  "distributionModel": "merkle",
  "graduated": false
}
```

### Phase 2: Bonding Curve (API Calls Earn Tokens)

#### Payment Flow ("Pay After Success")

```
User                    Backend Proxy              Builder API
  │                         │                          │
  │── API request ─────────▶│                          │
  │   + PAYMENT-SIGNATURE   │                          │
  │   header (base64 JSON)  │                          │
  │                         │── Verify payment ───────▶│ (no settle yet)
  │                         │   (signature, amount,    │
  │                         │    recipient, timing)    │
  │                         │                          │
  │                         │── Forward request ──────▶│
  │                         │   + X-IAO-Auth JWT       │
  │                         │                          │
  │                         │◀── Response (2xx) ───────│
  │                         │                          │
  │                         │── Settle payment ───────▶│ (NOW charge user)
  │                         │   executePaymentTransfer │
  │                         │                          │
  │                         │── Fire-and-forget: ──────│
  │                         │   accrue tokens          │
  │                         │                          │
  │◀── API response ────────│                          │
  │    + payment receipt     │                          │
```

**Key principle**: Users are **only charged** if the builder API returns a 2xx status.

#### Token Calculation Formula

```
tokensEarned = (fee × paymentTokenPrice) / (10 ^ paymentTokenDecimals)
```

**Example**:
- API fee: `10000` (0.01 USDC, 6 decimals)
- paymentTokenPrice: `25000000000000000000000` (25,000 tokens per USDC)
- paymentTokenDecimals: `6`
- **Result**: `(10000 × 25000000000000000000000) / 10^6 = 250,000,000,000,000,000` (250 tokens with 18 decimals)

#### Atomic Firestore Update

After payment settles, `incrementVirtualDistributedWithEarnings()` runs in a **single Firestore transaction**:

**Updates `iao-tokens/{tokenAddress}`**:
- `virtualTokensDistributed` += tokensEarned (capped at graduation threshold)
- `totalFeesCollected` += fee
- `pendingFeesForDistribution` += fee

**Updates `token-earnings/{tokenAddress}#{userAddress}`**:
- `totalTokensEarned` += tokensEarned
- `totalFeesPaid` += fee
- `callCount` += 1

This atomic operation ensures **no race conditions** — even under concurrent API calls.

#### Graduation Thresholds

| Chain | Threshold | With Decimals |
|-------|-----------|---------------|
| EVM (Base Sepolia) | 625,000,000 tokens | `625000000000000000000000000` (18 decimals) |
| Solana (Devnet) | 625,000,000 tokens | `625000000000000000` (9 decimals) |

The threshold = 62.5% of 1 billion total supply.

Can be overridden with `TEST_GRADUATION_THRESHOLD` env var for testing.

### Phase 3: Graduation

When `virtualTokensDistributed >= graduationThreshold`:

1. **Dispatch** — `graduationDispatcher.ts` creates a named Cloud Task (`graduate-{tokenAddress}`)
2. **Lock** — Backend acquires Firestore graduation lock (5-min TTL)
3. **Build Merkle Tree** — From all `token-earnings` entries for this token

   **Solana leaf hash**:
   ```
   leaf = keccak256(keccak256(pubkey_32bytes || amount_u64_le))
   ```

   **EVM leaf hash** (OpenZeppelin StandardMerkleTree):
   ```
   leaf = ABI.encode(['address', 'uint256'], [userAddress, amount])
   ```

4. **Store tree** in Firestore `merkle-trees/{tokenAddress}`
5. **Invoke Cloud Function** — Sets Merkle root on-chain + deploys liquidity
   - **EVM**: `TokenDistributor.graduateTokenWithMerkle(root)` → Uniswap V4 pool
   - **Solana**: `graduate_with_merkle(root)` → Raydium CLMM pool
6. **Confirm** — Cloud Function calls back, backend sets `graduated: true`

### Phase 4: Claiming (Post-Graduation)

After graduation, users claim their earned tokens on-chain:

1. **Get proof**: `GET /api/earnings/:serverSlug/:userAddress`
   - Returns `{ totalTokensEarned, merkleProof[], merkleIndex }`
   - Proof is generated from stored `treeDump`

2. **Submit claim on-chain**:
   - **EVM**: Call `IAOTokenV2.merkleClaim(amount, proof)`
   - **Solana**: Call `merkle_claim` instruction with proof

3. **Backend updates**: `claimed: true`, `claimTxHash` in `token-earnings`

### Fee Distribution (Weekly)

Accumulated fees (`pendingFeesForDistribution`) are distributed weekly:

1. Cloud Scheduler triggers `POST /internal/trigger-fee-distribution`
2. Backend groups non-graduated tokens by chain
3. Calls fee distribution Cloud Functions
4. On-chain split: builder share + team share + buyback
5. Callback clears `pendingFeesForDistribution`

### Database Collections

| Collection | Document ID | Purpose |
|------------|-------------|---------|
| `iao-tokens` | `{tokenAddress}` | Token metadata, virtual distribution tracking, graduation state |
| `token-earnings` | `{tokenAddress}#{userAddress}` | Per-user earnings accumulation, claim state |
| `merkle-trees` | `{tokenAddress}` | Merkle root, leaves, tree dump for proof generation |
| `graduation-locks` | `{tokenAddress}` | 5-min TTL lock preventing concurrent graduation |
| `api-metrics` | `{tokenAddress}_{apiSlug}` | Success/failure rates, latency, revenue per API |
| `user-requests` | `{tokenAddress}_{userAddress}_{requestNumber}` | Individual call history |

### Key Services

| Service | File | Role |
|---------|------|------|
| `firestoreTokenService.ts` | `src/services/` | Token CRUD, atomic virtual distribution increments |
| `firestoreEarningsService.ts` | `src/services/` | Per-user earnings tracking, Merkle claim state |
| `firestoreMerkleTreeService.ts` | `src/services/` | Store/retrieve Merkle trees, generate proofs |
| `graduationDispatcher.ts` | `src/services/` | Named Cloud Task dispatch with dedup |
| `graduationLock.ts` | `src/services/` | Firestore-based 5-min TTL lock |
| `graduationNotifier.ts` | `src/services/` | HTTP invocation of graduation Cloud Functions |
| `multiChainPaymentService.ts` | `src/services/` | Verify/settle payments across EVM & Solana |
| `evmContractService.ts` | `src/services/` | Read on-chain EVM state |
| `solanaContractService.ts` | `src/services/` | Read Solana program state |

---

## Quick Reference

### Full Deployment Checklist

1. **Deploy smart contracts** (EVM via Foundry, Solana via Anchor)
2. **Deploy backend** to Cloud Run (`deploy-cloud-run.sh`)
3. **Deploy cloud functions** (`deploy-cloud-functions.sh`)
4. **Create Cloud Tasks queue** (`gcloud tasks queues create graduation-queue`)
5. **Create Cloud Scheduler job** (weekly fee distribution cron)
6. **Configure all env vars** (secrets, URLs, shared auth tokens)
7. **Deploy frontend** to Firebase Hosting (`firebase deploy --only hosting`)

### Environment Variables Summary

**Backend (Cloud Run)**:
```
GCP_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS
THIRDWEB_SECRET_KEY, THIRDWEB_SERVER_WALLET_ADDRESS
BUILDER_SECRET_PHRASE
GRADUATION_QUEUE_NAME, GRADUATION_QUEUE_LOCATION
GRADUATION_FUNCTION_EVM_URL, GRADUATION_FUNCTION_SOLANA_URL
FEE_DISTRIBUTION_EVM_URL, FEE_DISTRIBUTION_SOLANA_URL
GRADUATION_INTERNAL_SECRET, FEE_DISTRIBUTION_SECRET
```

**Cloud Functions (EVM)**:
```
AUTOMATION_PRIVATE_KEY, RPC_URL, TOKEN_DISTRIBUTOR
BACKEND_URL, GRADUATION_INTERNAL_SECRET / FEE_DISTRIBUTION_SECRET
```

**Cloud Functions (Solana)**:
```
AUTOMATION_PRIVATE_KEY (base58), SOLANA_RPC_URL, IAO_PROGRAM_ID
BACKEND_URL, GRADUATION_INTERNAL_SECRET / FEE_DISTRIBUTION_SECRET
```
