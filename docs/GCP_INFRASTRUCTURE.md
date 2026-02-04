# APIX GCP Infrastructure & Deployment Guide

## Overview

APIX uses Google Cloud Platform for backend infrastructure with the following services:

| Service | Purpose | Region |
|---------|---------|--------|
| Cloud Run | Backend API servers | us-central1 |
| Cloud Functions | Graduation execution (on-chain TX) | us-central1 |
| Cloud Tasks | Graduation job queue (deduplication) | us-central1 |
| Firestore | Database (tokens, earnings, metrics) | us-central1 |
| Cloud Storage | Static assets, documentation | us-central1 |

---

## Cloud Run Services

### apix-backend (Legacy)
- **URL**: `https://apix-backend-<hash>-uc.a.run.app`
- **Purpose**: Original backend, kept for backwards compatibility
- **Min Instances**: 0 (scales to zero)

### apix-backend-v2 (Primary)
- **URL**: `https://apix-backend-v2-<hash>-uc.a.run.app`
- **Purpose**: Primary production backend with warm instances
- **Min Instances**: 1 (always warm)

### Deployment Commands

```bash
# Deploy to legacy backend
cd /home/error0180/APIX402BE
gcloud run deploy apix-backend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --quiet

# Deploy to primary backend (with warm instance)
gcloud run deploy apix-backend-v2 \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances=1 \
  --quiet
```

### Environment Variables (Cloud Run)

| Variable | Description |
|----------|-------------|
| `GCP_PROJECT_ID` | GCP project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON (or use default SA) |
| `THIRDWEB_SECRET_KEY` | Thirdweb API key for payment settlement |
| `THIRDWEB_SERVER_WALLET_ADDRESS` | Facilitator wallet address |
| `BUILDER_SECRET_PHRASE` | Shared secret for builder JWT auth |
| `GRADUATION_INTERNAL_SECRET` | Shared secret for internal endpoints |
| `GRADUATION_QUEUE_NAME` | Cloud Tasks queue name (default: `graduation-queue`) |
| `GRADUATION_QUEUE_LOCATION` | Queue region (default: `us-central1`) |
| `CLOUD_RUN_SERVICE_URL` | Self URL for Cloud Tasks callback |
| `GRADUATION_FUNCTION_EVM_URL` | EVM graduation Cloud Function URL |
| `GRADUATION_FUNCTION_SOLANA_URL` | Solana graduation Cloud Function URL |
| `TEST_GRADUATION_THRESHOLD` | (Optional) Override graduation threshold for testing |

---

## Cloud Functions

### graduation-evm
- **Runtime**: Node.js 20
- **Trigger**: HTTP POST
- **Timeout**: 540 seconds (9 minutes)
- **Memory**: 256 MB
- **Purpose**: Execute EVM graduation TX via TokenDistributor contract

### graduation-solana
- **Runtime**: Node.js 20
- **Trigger**: HTTP POST
- **Timeout**: 540 seconds
- **Memory**: 512 MB
- **Purpose**: Execute Solana graduation via batch_mint + deploy_liquidity

### Deployment Commands

```bash
# Deploy EVM graduation function
cd /home/error0180/APIX402BE/cloud-functions/graduation-evm
gcloud functions deploy graduation-evm \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=graduateEvm \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --memory=256MB

# Deploy Solana graduation function
cd /home/error0180/APIX402BE/cloud-functions/graduation-solana
gcloud functions deploy graduation-solana \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=graduateSolana \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --memory=512MB
```

### Environment Variables (Cloud Functions)

#### graduation-evm
| Variable | Description |
|----------|-------------|
| `AUTOMATION_PRIVATE_KEY` | Private key of minter wallet (hex) |
| `RPC_URL` | EVM RPC endpoint (e.g., Base Sepolia) |
| `TOKEN_DISTRIBUTOR` | TokenDistributor contract address |
| `BACKEND_URL` | Cloud Run URL for confirmation callback |
| `GRADUATION_INTERNAL_SECRET` | Shared secret for auth |

#### graduation-solana
| Variable | Description |
|----------|-------------|
| `AUTOMATION_PRIVATE_KEY` | Private key of automation wallet (base58) |
| `SOLANA_RPC_URL` | Solana RPC endpoint |
| `IAO_PROGRAM_ID` | IAO Factory program ID |
| `BACKEND_URL` | Cloud Run URL for confirmation callback |
| `GRADUATION_INTERNAL_SECRET` | Shared secret for auth |

---

## Cloud Tasks

### graduation-queue
- **Location**: us-central1
- **Purpose**: Deduplication and reliable delivery of graduation jobs
- **Retry Config**: Automatic retries on 5xx errors

### Setup Commands

```bash
# Create the graduation queue
gcloud tasks queues create graduation-queue \
  --location=us-central1 \
  --max-dispatches-per-second=10 \
  --max-concurrent-dispatches=5 \
  --max-attempts=5 \
  --min-backoff=10s \
  --max-backoff=300s
```

### How It Works

1. Backend detects graduation threshold crossed
2. Calls `dispatchGraduationTask()` with named task: `graduate-{tokenAddress}`
3. Cloud Tasks delivers POST to `/internal/graduate/:tokenAddress`
4. Named tasks provide deduplication (duplicate dispatches return ALREADY_EXISTS)

---

## Firestore Collections

| Collection | Purpose |
|------------|---------|
| `iao-tokens` | Token metadata (slug, APIs, fees, graduated status) |
| `user-earnings` | Per-user token earnings (for Merkle tree) |
| `merkle-trees` | Generated Merkle trees for claiming |
| `api-metrics` | API performance metrics |
| `agents` | AI agent configurations |
| `chat-sessions` | Chat session tracking |
| `chat-messages` | Chat message history |
| `agent-payments` | Agent payment records |
| `cache` | General caching layer |
| `rate-limits` | Rate limiting data |
| `chain-configs` | Multi-chain configurations |
| `graduation-locks` | Graduation lock state (prevent concurrent graduation) |

---

## Graduation Flow Diagram

```
┌─────────────────┐
│  User API Call  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│         Cloud Run Backend               │
│                                         │
│  1. Process payment (Thirdweb)          │
│  2. Track earnings in Firestore         │
│  3. Increment virtualTokensDistributed  │
│  4. Check threshold:                    │
│     - Default: 625M tokens              │
│     - Override: TEST_GRADUATION_THRESHOLD│
└────────┬────────────────────────────────┘
         │ threshold crossed
         ▼
┌─────────────────────────────────────────┐
│       dispatchGraduationTask()          │
│                                         │
│  Creates named Cloud Task:              │
│  - Name: graduate-{tokenAddress}        │
│  - Target: /internal/graduate/:token    │
│  - Dedup: ALREADY_EXISTS = ignored      │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│           Cloud Tasks                   │
│                                         │
│  - Reliable delivery                    │
│  - Automatic retries                    │
│  - Deduplication via named tasks        │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│    /internal/graduate/:tokenAddress     │
│                                         │
│  1. Check if already graduated          │
│  2. Acquire graduation lock             │
│  3. Fetch earnings from Firestore       │
│  4. Build Merkle tree (OpenZeppelin)    │
│  5. Store tree in Firestore             │
│  6. Call notifyForGraduation()          │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│        notifyForGraduation()            │
│                                         │
│  Routes by chainId:                     │
│  - Numeric (84532) → graduation-evm     │
│  - "devnet" → graduation-solana         │
└────────┬────────────────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐  ┌──────────┐
│  EVM   │  │  Solana  │
│Function│  │ Function │
└───┬────┘  └────┬─────┘
    │            │
    │  EVM:      │  Solana:
    │  graduateTokenWithMerkle()
    │            │  1. batch_mint (chunks of 50)
    │            │  2. deploy_liquidity
    │            │
    └─────┬──────┘
          │
          ▼
┌─────────────────────────────────────────┐
│   /internal/graduation-confirm/:token   │
│                                         │
│   Sets graduated=true in Firestore      │
└─────────────────────────────────────────┘
```

---

## Testing Graduation with Small Amounts

The backend supports a `TEST_GRADUATION_THRESHOLD` environment variable to test graduation without spending 25k USDC.

### Enable Test Mode

```bash
# Calculate threshold for N requests at $X fee
# Formula: requests × fee_in_usdc × 25000 × 10^18
# Example: 5 requests at $0.01 = 5 × 0.01 × 25000 × 10^18 = 1,250 × 10^18

gcloud run services update apix-backend-v2 \
  --region us-central1 \
  --set-env-vars "TEST_GRADUATION_THRESHOLD=1250000000000000000000"
```

### Disable Test Mode

```bash
gcloud run services update apix-backend-v2 \
  --region us-central1 \
  --remove-env-vars "TEST_GRADUATION_THRESHOLD"
```

### Test Thresholds Reference

| Requests | Fee | Threshold Value (18 decimals) |
|----------|-----|-------------------------------|
| 1 | $0.01 | `250000000000000000000` |
| 5 | $0.01 | `1250000000000000000000` |
| 10 | $0.01 | `2500000000000000000000` |
| 1 | $1.00 | `25000000000000000000000` |
| 5 | $1.00 | `125000000000000000000000` |

---

## Monitoring & Logs

### View Cloud Run Logs

```bash
# Recent logs
gcloud run services logs read apix-backend-v2 --region=us-central1 --limit=100

# Stream logs
gcloud run services logs tail apix-backend-v2 --region=us-central1

# Filter for graduation
gcloud run services logs read apix-backend-v2 --region=us-central1 | grep -i "graduation"
```

### View Cloud Function Logs

```bash
# EVM function logs
gcloud functions logs read graduation-evm --region=us-central1 --limit=50

# Solana function logs
gcloud functions logs read graduation-solana --region=us-central1 --limit=50
```

### View Cloud Tasks

```bash
# List tasks in queue
gcloud tasks list --queue=graduation-queue --location=us-central1

# Describe queue
gcloud tasks queues describe graduation-queue --location=us-central1
```

---

## Troubleshooting

### "Graduation task already exists"
- **Cause**: Deduplication working correctly
- **Action**: None needed, task is already queued

### "Missing GCP_PROJECT_ID or CLOUD_RUN_SERVICE_URL"
- **Cause**: Environment variables not set
- **Action**: Set required env vars on Cloud Run

### "No Cloud Function configured for chainId"
- **Cause**: `GRADUATION_FUNCTION_EVM_URL` or `GRADUATION_FUNCTION_SOLANA_URL` not set
- **Action**: Set the Cloud Function URLs

### Cloud Function returns 401
- **Cause**: `GRADUATION_INTERNAL_SECRET` mismatch
- **Action**: Ensure same secret on Cloud Run and Cloud Functions

### Graduation TX fails
- **Cause**: Various (insufficient gas, wrong RPC, contract error)
- **Action**: Check Cloud Function logs for detailed error

---

## Contract Addresses (Base Sepolia - ChainId 84532)

| Contract | Address |
|----------|---------|
| IAOTokenFactory | `0x5a40F7f30b25D07aB1C06dEB7400554Bc20f8ad4` |
| TokenDistributor | Check factory or deployment logs |
| USDC (Mock) | Check `paymentTokenInfo` in factory |

---

## Quick Reference

### Full Deployment (All Services)

```bash
cd /home/error0180/APIX402BE

# 1. Deploy Cloud Run backends
gcloud run deploy apix-backend --source . --region us-central1 --allow-unauthenticated &
gcloud run deploy apix-backend-v2 --source . --region us-central1 --allow-unauthenticated --min-instances=1 &

# 2. Deploy Cloud Functions
cd cloud-functions/graduation-evm
gcloud functions deploy graduation-evm --gen2 --runtime=nodejs20 --region=us-central1 --source=. --entry-point=graduateEvm --trigger-http --allow-unauthenticated --timeout=540s &

cd ../graduation-solana
gcloud functions deploy graduation-solana --gen2 --runtime=nodejs20 --region=us-central1 --source=. --entry-point=graduateSolana --trigger-http --allow-unauthenticated --timeout=540s &

wait
echo "All deployments complete"
```

### Check Status

```bash
# Cloud Run services
gcloud run services list --region=us-central1

# Cloud Functions
gcloud functions list --region=us-central1

# Cloud Tasks queues
gcloud tasks queues list --location=us-central1
```
