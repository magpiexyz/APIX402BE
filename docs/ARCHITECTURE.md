# APIX System Architecture

This document provides an overview of the APIX (IAO - Initial API Offering) system architecture, components, and data flows.

## System Overview

```
                                    APIX Architecture

    +------------------+         +------------------+         +------------------+
    |                  |         |                  |         |                  |
    |    Frontend      |  API    |    Backend       |  RPC    |    Blockchain    |
    |   (Firebase)     +-------->+   (Cloud Run)    +-------->+   (Base/Solana)  |
    |                  |         |                  |         |                  |
    +--------+---------+         +--------+---------+         +------------------+
             |                            |
             |                            |
             v                            v
    +------------------+         +------------------+
    |                  |         |                  |
    |    Thirdweb      |         |    Firestore     |
    |   (Wallets)      |         |   (Database)     |
    |                  |         |                  |
    +------------------+         +------------------+
```

## Components

### Frontend (APIX402FE)

**Technology**: React + Vite + TypeScript
**Hosting**: Firebase Hosting
**Repository**: `/home/error0180/APIX402FE`

Responsibilities:
- API marketplace UI for browsing and discovering APIs
- Server/API registration forms for developers
- Wallet connection via Thirdweb SDK
- Payment authorization signing (EIP-3009)
- Real-time metrics and analytics dashboards
- AI agent chat interface

Key Features:
- Multi-chain wallet support (EVM + Solana)
- Payment signature generation without transaction submission
- Real-time bonding curve progress visualization

### Backend (APIX402BE)

**Technology**: Express.js + TypeScript
**Hosting**: Google Cloud Run
**Repository**: `/home/error0180/APIX402BE`

Responsibilities:
- API proxy for all registered endpoints
- Payment verification and settlement via Thirdweb
- Request forwarding to builder endpoints
- Metrics collection and aggregation
- Rate limiting and circuit breaking
- AI agent orchestration

Key Features:
- Pay-after-success model (users only charged on successful responses)
- JWT-based builder authentication
- Multi-chain payment support

### Database (Firestore)

**Service**: Google Cloud Firestore
**Mode**: Native mode

Collections:
- `iao-tokens` - Registered API servers and their tokens
- `user-requests` - Historical API call records
- `request-queue` - Pending token distribution queue
- `api-metrics` - Performance and revenue metrics
- `agents` - AI agent configurations
- `chat-sessions` / `chat-messages` - Agent conversation history
- `rate-limits` - Per-user rate limit tracking
- `chain-configs` - Multi-chain network configurations

### Smart Contracts

**Networks**: Base Sepolia (EVM), Solana Devnet
**Repository**: `/home/error0180/hyperpie/contracts/IAO`

Contracts:
- **IAOTokenFactory** - Creates new IAO tokens for API servers
- **IAOToken** - ERC20 with bonding curve distribution logic
- **LpGuardHook** - Uniswap V4 hook for liquidity protection

## Data Flows

### API Call Flow

```
User                Frontend              Backend               Builder API
  |                    |                     |                      |
  |  1. Select API     |                     |                      |
  +-------------------->                     |                      |
  |                    |                     |                      |
  |  2. Sign Payment   |                     |                      |
  |<------------------+|                     |                      |
  |                    |                     |                      |
  |  3. Submit Request |                     |                      |
  +-------------------->-------------------->|                      |
  |                    |                     |                      |
  |                    |  4. Verify Payment  |                      |
  |                    |  (no settlement)    |                      |
  |                    |                     |                      |
  |                    |  5. Forward Request |                      |
  |                    |                     +--------------------->|
  |                    |                     |                      |
  |                    |                     |  6. API Response     |
  |                    |                     |<---------------------+
  |                    |                     |                      |
  |                    |  7. Settle Payment  |                      |
  |                    |  (only if 2xx)      |                      |
  |                    |                     |                      |
  |  8. Return Response|                     |                      |
  |<-------------------+<--------------------+                      |
```

### Token Distribution Flow

```
Payment Settlement        Backend              Smart Contract
       |                    |                       |
       |  1. Payment Settled|                       |
       +------------------->|                       |
       |                    |                       |
       |                    |  2. Queue Request     |
       |                    |  (Firestore)          |
       |                    |                       |
       |                    |  3. Trigger Mint      |
       |                    +---------------------->|
       |                    |                       |
       |                    |  4. Calculate Tokens  |
       |                    |  (Bonding Curve)      |
       |                    |                       |
       |                    |  5. Mint to User      |
       |                    |<----------------------+
       |                    |                       |
       |                    |  6. Check Graduation  |
       |                    |  (if threshold met)   |
       |                    |                       |
```

### Server Registration Flow

```
Developer           Frontend              Backend              Blockchain
    |                  |                     |                     |
    | 1. Fill Form     |                     |                     |
    +----------------->|                     |                     |
    |                  |                     |                     |
    |                  | 2. Validate         |                     |
    |                  +-------------------->|                     |
    |                  |                     |                     |
    |                  | 3. Validation OK    |                     |
    |                  |<--------------------+                     |
    |                  |                     |                     |
    |                  | 4. Create Token     |                     |
    |                  +-------------------------------------------->
    |                  |                     |                     |
    |                  | 5. Token Created    |                     |
    |                  |<--------------------------------------------
    |                  |                     |                     |
    |                  | 6. Register Server  |                     |
    |                  +-------------------->|                     |
    |                  |                     |                     |
    |                  |                     | 7. Store in         |
    |                  |                     | Firestore           |
    |                  |                     |                     |
    | 8. Success       |                     |                     |
    |<-----------------+<--------------------+                     |
```

## GCP Services Used

| Service | Purpose |
|---------|---------|
| **Cloud Run** | Backend API hosting (auto-scaling, serverless) |
| **Firebase Hosting** | Frontend static site hosting with CDN |
| **Firestore** | NoSQL database for all application data |
| **Cloud Build** | CI/CD pipeline for automated deployments |
| **Secret Manager** | Secure storage for API keys and credentials |
| **Cloud Logging** | Centralized logging and monitoring |
| **Identity Platform** | Optional user authentication |

## Security Considerations

### Authentication
- **Users**: Wallet-based authentication (sign message to prove ownership)
- **Builders**: JWT tokens with shared secret (`BUILDER_SECRET_PHRASE`)
- **Backend**: Service account credentials for GCP resources

### Payment Security
- Payments use EIP-3009 (signed authorization, settled separately)
- Payment verified before forwarding, settled only on success
- Thirdweb facilitator handles on-chain settlement

### Rate Limiting
- Per-user rate limits tracked in Firestore
- Circuit breaker pattern for builder endpoint failures
- Configurable limits per API

## Scalability

### Backend (Cloud Run)
- Auto-scales from 0 to N instances based on traffic
- Stateless design allows horizontal scaling
- Cold start optimization with min instances

### Database (Firestore)
- Automatic scaling with no configuration
- Strong consistency within document
- Composite indexes for complex queries

### Frontend (Firebase Hosting)
- Global CDN distribution
- Automatic SSL certificates
- Cache optimization for static assets
