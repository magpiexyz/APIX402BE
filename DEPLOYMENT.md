# APIX/IAO Deployment Summary

## 1. Smart Contracts (Base Sepolia)

| Contract | Address | Description |
|----------|---------|-------------|
| HyperpieConfig | `0x203cDD30D70f6A40f3a55462DC9196DeeeC8aB0C` | Role-based access control |
| IAOTokenFactory (Proxy) | `0x9E2CF215276e3Ad1f94e0355c4D821E3E9c3d800` | Creates new IAO tokens |
| TokenDistributor | `0x180160a4aca6A5913765571763a07D1158419B76` | Batch graduation & fee distribution |
| RoleCheckerLib | `0x47478d7C5F08F5a4978c5062a2a2a43EfabADEdF` | Library for role checks |

---

## 2. Backend (Cloud Run)

**Service:** `apix-backend-v2`
**Source:** `/home/error0180/APIX402BE`
**URL:** `https://apix-backend-v2-951726146933.us-central1.run.app`

**Deploy command:**
```bash
cd /home/error0180/APIX402BE
gcloud run deploy apix-backend-v2 --source . --region us-central1 --allow-unauthenticated
```

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `GCP_PROJECT_ID` | `trim-dahlia-485008-u2` |
| `THIRDWEB_SECRET_KEY` | Thirdweb API key |
| `THIRDWEB_SERVER_WALLET_ADDRESS` | Facilitator wallet |
| `BUILDER_SECRET_PHRASE` | JWT signing secret |
| `TEST_GRADUATION_THRESHOLD` | (Optional) For testing graduation |

---

## 3. Cloud Functions (Gen2)

| Function | Source | Trigger | Description |
|----------|--------|---------|-------------|
| `graduation-evm` | `cloud-functions/graduation-evm/` | HTTP (Cloud Tasks) | Executes graduation + fee distribution |
| `fee-distribution-evm` | `cloud-functions/fee-distribution-evm/` | HTTP (Cloud Scheduler) | Weekly fee distribution |

**Deploy commands:**
```bash
cd /home/error0180/APIX402BE/cloud-functions/graduation-evm
gcloud functions deploy graduation-evm --gen2 --runtime=nodejs20 --trigger-http --region=us-central1 --entry-point=graduateToken

cd /home/error0180/APIX402BE/cloud-functions/fee-distribution-evm
gcloud functions deploy fee-distribution-evm --gen2 --runtime=nodejs20 --trigger-http --region=us-central1 --entry-point=distributeFeesEvm
```

**Environment Variables (both functions):**
| Variable | Description |
|----------|-------------|
| `AUTOMATION_PRIVATE_KEY` | Minter wallet private key |
| `RPC_URL` | `https://sepolia.base.org` |
| `TOKEN_DISTRIBUTOR` | `0x180160a4aca6A5913765571763a07D1158419B76` |
| `BACKEND_URL` | Cloud Run URL |
| `FEE_DISTRIBUTION_SECRET` | Shared secret |

---

## 4. Cloud Scheduler (Weekly Fee Distribution)

```bash
gcloud scheduler jobs create http fee-distribution-weekly \
  --schedule="0 0 * * 0" \
  --uri="https://fee-distribution-evm-XXXXX.run.app" \
  --http-method=POST \
  --headers="X-Fee-Distribution-Secret=YOUR_SECRET"
```

---

## 5. Cloud Tasks Queue

```bash
gcloud tasks queues create graduation-queue --location=us-central1
```

---

## 6. Firestore Collections

| Collection | Document ID | Key Fields |
|------------|-------------|------------|
| `iao-tokens` | `{tokenAddress}` | `slug`, `name`, `symbol`, `apis[]`, `chainId`, `virtualTokensDistributed`, `totalFeesCollected`, `pendingFeesForDistribution`, `isGraduated` |
| `user-earnings` | `{tokenAddress}_{userAddress}` | `totalTokensEarned`, `totalFeesPaid`, `callCount`, `claimed`, `claimTxHash` |
| `user-requests` | `{tokenAddress}_{userAddress}_{requestNum}` | `iaoToken`, `userAddress`, `timestamp`, `fee`, `tokensEarned` |
| `api-metrics` | `{tokenAddress}_{apiSlug}` | `totalCalls`, `successCount`, `totalLatency`, `lastCallAt` |
| `agents` | `{agentId}` | `name`, `description`, `tools[]`, `llmProvider`, `ownerAddress` |
| `chat-sessions` | `{sessionId}` | `agentId`, `userAddress`, `createdAt` |
| `chat-messages` | `{messageId}` | `sessionId`, `role`, `content`, `timestamp` |
| `chain-configs` | `{chainId}` | `rpcUrl`, `factoryAddress`, `paymentToken` |

---

## 7. Frontend (Firebase Hosting)

**Source:** `/home/error0180/APIX402FE`
**URL:** `https://apix-v2.web.app`

**Deploy command:**
```bash
cd /home/error0180/APIX402FE
npm run build
firebase deploy --only hosting
```

**Environment Variables (`.env.production`):**
```
VITE_API_BASE_URL=https://apix-backend-v2-951726146933.us-central1.run.app
```

---

## 8. Required IAM Roles

| Service Account | Role | On |
|----------------|------|-----|
| Cloud Run SA | `roles/cloudtasks.enqueuer` | graduation-queue |
| Cloud Functions SA | `roles/run.invoker` | Cloud Run |
| Factory Contract | `DEFAULT_ADMIN_ROLE` | HyperpieConfig |

---

## Quick Full Deploy Sequence

```bash
# 1. Backend
cd /home/error0180/APIX402BE && gcloud run deploy apix-backend-v2 --source . --region us-central1

# 2. Cloud Functions
cd cloud-functions/graduation-evm && gcloud functions deploy graduation-evm --gen2 --runtime=nodejs20 --trigger-http --region=us-central1
cd ../fee-distribution-evm && gcloud functions deploy fee-distribution-evm --gen2 --runtime=nodejs20 --trigger-http --region=us-central1

# 3. Frontend
cd /home/error0180/APIX402FE && npm run build && firebase deploy --only hosting
```

---

## Testing Graduation (with low threshold)

1. Set `TEST_GRADUATION_THRESHOLD` env var on Cloud Run:
   ```bash
   gcloud run services update apix-backend-v2 --region=us-central1 \
     --set-env-vars="TEST_GRADUATION_THRESHOLD=1250000000000000000000"
   ```

2. Register a test server with $0.01 API fee

3. Make 5 API calls to trigger graduation

4. Remove env var after testing:
   ```bash
   gcloud run services update apix-backend-v2 --region=us-central1 \
     --remove-env-vars="TEST_GRADUATION_THRESHOLD"
   ```
