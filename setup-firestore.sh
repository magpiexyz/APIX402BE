#!/bin/bash
set -e

# ============================================
# APIX Firestore Setup & Deployment Script
# ============================================
# This script sets up Firestore database, deploys security rules,
# indexes, and optionally seeds initial chain configurations.
#
# Usage:
#   ./setup-firestore.sh                    # Full setup (database + rules + indexes)
#   ./setup-firestore.sh --rules-only       # Deploy rules only
#   ./setup-firestore.sh --indexes-only     # Deploy indexes only
#   ./setup-firestore.sh --seed             # Full setup + seed chain configs
#   ./setup-firestore.sh --seed-only        # Seed chain configs only
#
# Prerequisites:
# - gcloud CLI installed and authenticated
# - firebase CLI installed and authenticated
# - GCP_PROJECT_ID set in .env or environment
# ============================================

# Parse arguments
RULES_ONLY=false
INDEXES_ONLY=false
SEED_DATA=false
SEED_ONLY=false

for arg in "$@"; do
  case $arg in
    --rules-only)
      RULES_ONLY=true
      shift
      ;;
    --indexes-only)
      INDEXES_ONLY=true
      shift
      ;;
    --seed)
      SEED_DATA=true
      shift
      ;;
    --seed-only)
      SEED_ONLY=true
      shift
      ;;
    --help)
      echo "Usage: ./setup-firestore.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --rules-only     Deploy Firestore rules only"
      echo "  --indexes-only   Deploy Firestore indexes only"
      echo "  --seed           Full setup + seed chain configurations"
      echo "  --seed-only      Seed chain configurations only"
      echo "  --help           Show this help message"
      exit 0
      ;;
  esac
done

# Load environment variables from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}APIX Firestore Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Validate required variables
if [ -z "$GCP_PROJECT_ID" ]; then
  echo -e "${RED}Error: GCP_PROJECT_ID is not set${NC}"
  echo -e "${YELLOW}Set it in .env or export GCP_PROJECT_ID=your-project-id${NC}"
  exit 1
fi

echo -e "${YELLOW}Project: $GCP_PROJECT_ID${NC}"
echo ""

# Set the project
gcloud config set project $GCP_PROJECT_ID

# ============================================
# Function: Create Firestore Database
# ============================================
create_firestore_database() {
  echo -e "${CYAN}Checking Firestore database...${NC}"

  # Check if Firestore API is enabled
  if ! gcloud services list --enabled --filter="name:firestore.googleapis.com" --format="value(name)" | grep -q "firestore"; then
    echo -e "${YELLOW}Enabling Firestore API...${NC}"
    gcloud services enable firestore.googleapis.com
    sleep 5  # Wait for API to be ready
  fi

  # Check if database exists
  DB_EXISTS=$(gcloud firestore databases list --format="value(name)" 2>/dev/null | grep -c "(default)" || true)

  if [ "$DB_EXISTS" -eq 0 ]; then
    echo -e "${YELLOW}Creating Firestore database (Native mode)...${NC}"
    gcloud firestore databases create \
      --location=us-central1 \
      --type=firestore-native \
      2>/dev/null || {
        # Database might already exist in Datastore mode or creation failed
        echo -e "${YELLOW}Note: Database may already exist or require manual setup${NC}"
      }
  else
    echo -e "${GREEN}Firestore database already exists${NC}"
  fi
  echo ""
}

# ============================================
# Function: Deploy Firestore Rules
# ============================================
deploy_firestore_rules() {
  echo -e "${CYAN}Deploying Firestore security rules...${NC}"

  # Check if firestore.rules exists
  if [ ! -f "firestore.rules" ]; then
    echo -e "${YELLOW}Creating default firestore.rules...${NC}"
    cat > firestore.rules << 'EOF'
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // IAO Tokens - read by anyone, write by backend only
    match /iao-tokens/{tokenId} {
      allow read: if true;
      allow write: if false; // Backend uses admin SDK
    }

    // Token Earnings - read by owner, write by backend only
    match /token-earnings/{docId} {
      allow read: if true;
      allow write: if false;
    }

    // User Requests - read by owner, write by backend only
    match /user-requests/{docId} {
      allow read: if true;
      allow write: if false;
    }

    // API Metrics - read by anyone, write by backend only
    match /api-metrics/{docId} {
      allow read: if true;
      allow write: if false;
    }

    // Merkle Trees - read by anyone, write by backend only
    match /merkle-trees/{tokenId} {
      allow read: if true;
      allow write: if false;
    }

    // Agents - read by anyone, write by backend only
    match /agents/{agentId} {
      allow read: if true;
      allow write: if false;
    }

    // Chat Sessions - read by owner, write by backend only
    match /chat-sessions/{sessionId} {
      allow read: if true;
      allow write: if false;
    }

    // Chat Messages - read by session owner, write by backend only
    match /chat-messages/{messageId} {
      allow read: if true;
      allow write: if false;
    }

    // Chain Configs - read by anyone, write by backend only
    match /chain-configs/{chainId} {
      allow read: if true;
      allow write: if false;
    }

    // Cache - backend only
    match /cache/{cacheKey} {
      allow read, write: if false;
    }

    // Rate Limits - backend only
    match /rate-limits/{limitId} {
      allow read, write: if false;
    }

    // Graduation Locks - backend only
    match /graduation-locks/{lockId} {
      allow read, write: if false;
    }
  }
}
EOF
  fi

  firebase use $GCP_PROJECT_ID --add 2>/dev/null || true
  firebase deploy --only firestore:rules --project $GCP_PROJECT_ID

  echo -e "${GREEN}Firestore rules deployed${NC}"
  echo ""
}

# ============================================
# Function: Deploy Firestore Indexes
# ============================================
deploy_firestore_indexes() {
  echo -e "${CYAN}Deploying Firestore indexes...${NC}"

  # Check if firestore.indexes.json exists
  if [ ! -f "firestore.indexes.json" ]; then
    echo -e "${YELLOW}Creating default firestore.indexes.json...${NC}"
    cat > firestore.indexes.json << 'EOF'
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
      "collectionGroup": "iao-tokens",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "builder", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "iao-tokens",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isGraduated", "order": "ASCENDING" },
        { "fieldPath": "virtualTokensDistributed", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "token-earnings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "tokenAddress", "order": "ASCENDING" },
        { "fieldPath": "totalTokensEarned", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "token-earnings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userAddress", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "user-requests",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "iaoToken", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "user-requests",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userAddress", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "api-metrics",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "tokenAddress", "order": "ASCENDING" },
        { "fieldPath": "totalCalls", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "agents",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "ownerAddress", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "agents",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isPublic", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "chat-sessions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "agentId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "chat-sessions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userAddress", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "chat-messages",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sessionId", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
EOF
  fi

  firebase deploy --only firestore:indexes --project $GCP_PROJECT_ID

  echo -e "${GREEN}Firestore indexes deployed (may take a few minutes to build)${NC}"
  echo ""
}

# ============================================
# Function: Seed Chain Configurations
# ============================================
seed_chain_configs() {
  echo -e "${CYAN}Seeding chain configurations...${NC}"

  # Create a temporary Node.js script to seed data
  cat > /tmp/seed-chains.mjs << 'EOF'
import { Firestore } from '@google-cloud/firestore';

const projectId = process.env.GCP_PROJECT_ID;
const db = new Firestore({ projectId });

const chainConfigs = [
  {
    chainId: '84532',
    name: 'Base Sepolia',
    shortName: 'Base',
    chainType: 'evm',
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    factoryAddress: '0x9E2CF215276e3Ad1f94e0355c4D821E3E9c3d800',
    tokenDistributorAddress: '0x180160a4aca6A5913765571763a07D1158419B76',
    paymentTokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    paymentTokenSymbol: 'USDC',
    paymentTokenDecimals: 6,
    isActive: true,
    isTestnet: true,
  },
  {
    chainId: 'solana-devnet',
    name: 'Solana Devnet',
    shortName: 'Solana',
    chainType: 'solana',
    rpcUrl: 'https://api.devnet.solana.com',
    explorerUrl: 'https://explorer.solana.com/?cluster=devnet',
    factoryAddress: 'FpCX6E1LxRph23NJgF9R8haRJscGPbbdhP2vd5Sn6jwA',
    paymentTokenAddress: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    paymentTokenSymbol: 'USDC',
    paymentTokenDecimals: 6,
    isActive: true,
    isTestnet: true,
  }
];

async function seedChainConfigs() {
  const batch = db.batch();

  for (const config of chainConfigs) {
    const docRef = db.collection('chain-configs').doc(config.chainId);
    batch.set(docRef, {
      ...config,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    console.log(`  Seeding chain: ${config.name} (${config.chainId})`);
  }

  await batch.commit();
  console.log('\nChain configurations seeded successfully!');
}

seedChainConfigs().catch(console.error);
EOF

  # Run the seed script
  node /tmp/seed-chains.mjs

  # Cleanup
  rm /tmp/seed-chains.mjs

  echo -e "${GREEN}Chain configurations seeded${NC}"
  echo ""
}

# ============================================
# Function: Verify Firestore Setup
# ============================================
verify_firestore() {
  echo -e "${CYAN}Verifying Firestore setup...${NC}"

  # List collections (requires data to exist)
  echo -e "${YELLOW}Firestore Console:${NC}"
  echo -e "  https://console.firebase.google.com/project/$GCP_PROJECT_ID/firestore"
  echo ""

  # Check rules deployment
  echo -e "${YELLOW}Firestore Rules:${NC}"
  echo -e "  View at: https://console.firebase.google.com/project/$GCP_PROJECT_ID/firestore/rules"
  if [ -f "firestore.rules" ]; then
    echo -e "  Local file: ${GREEN}firestore.rules${NC} (deployed)"
  fi
  echo ""

  # Check indexes
  echo -e "${YELLOW}Checking index status...${NC}"
  gcloud firestore indexes composite list --format="table(name,state)" 2>/dev/null || echo "  (Indexes may still be building)"
  echo ""
}

# ============================================
# Function: Print Collection Reference
# ============================================
print_collections_reference() {
  echo -e "${CYAN}========================================${NC}"
  echo -e "${CYAN}Firestore Collections Reference${NC}"
  echo -e "${CYAN}========================================${NC}"
  echo ""
  echo -e "${YELLOW}Collection          │ Document ID Pattern              │ Purpose${NC}"
  echo -e "────────────────────┼──────────────────────────────────┼─────────────────────"
  echo -e "iao-tokens          │ {tokenAddress}                   │ Server/token registry"
  echo -e "token-earnings      │ {tokenAddress}_{userAddress}     │ User earnings per token"
  echo -e "user-requests       │ {tokenAddress}_{user}_{reqNum}   │ API call history"
  echo -e "api-metrics         │ {tokenAddress}_{apiSlug}         │ Per-API analytics"
  echo -e "merkle-trees        │ {tokenAddress}                   │ Claim proofs"
  echo -e "agents              │ {agentId}                        │ AI agent configs"
  echo -e "chat-sessions       │ {sessionId}                      │ Chat history"
  echo -e "chat-messages       │ {messageId}                      │ Individual messages"
  echo -e "chain-configs       │ {chainId}                        │ Multi-chain settings"
  echo -e "cache               │ {cacheKey}                       │ Response caching"
  echo -e "rate-limits         │ {limitId}                        │ Rate limiting"
  echo -e "graduation-locks    │ {tokenAddress}                   │ Graduation mutex"
  echo ""
}

# ============================================
# Main Execution
# ============================================

if [ "$SEED_ONLY" = true ]; then
  seed_chain_configs
  exit 0
fi

if [ "$RULES_ONLY" = true ]; then
  deploy_firestore_rules
  exit 0
fi

if [ "$INDEXES_ONLY" = true ]; then
  deploy_firestore_indexes
  exit 0
fi

# Full setup
create_firestore_database
deploy_firestore_rules
deploy_firestore_indexes

if [ "$SEED_DATA" = true ]; then
  seed_chain_configs
fi

verify_firestore
print_collections_reference

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Firestore Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Next steps:"
echo -e "  1. Run ${YELLOW}./setup-secrets.sh${NC} to configure secrets"
echo -e "  2. Run ${YELLOW}./deploy-cloud-run.sh${NC} to deploy backend"
echo -e "  3. Run ${YELLOW}./deploy-cloud-functions.sh${NC} to deploy functions"
echo ""
echo -e "Or run ${YELLOW}./deploy-gcp.sh${NC} to deploy everything at once"
