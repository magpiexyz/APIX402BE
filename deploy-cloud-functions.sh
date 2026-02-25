#!/bin/bash
set -e

# ============================================
# Deploy Cloud Functions
# ============================================
# Deploys graduation-evm and graduation-solana functions
#
# Usage:
#   ./deploy-cloud-functions.sh                    # Uses BACKEND_URL from .env
#   ./deploy-cloud-functions.sh <backend-url>     # Uses provided URL
#   BACKEND_URL=<url> ./deploy-cloud-functions.sh  # Uses env var
#
# Prerequisites:
# - Run ./setup-secrets.sh first to create secrets
# - Cloud Run must be deployed first
# ============================================

# Load environment variables from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
fi

# Override BACKEND_URL if provided as argument
if [ -n "$1" ]; then
  BACKEND_URL="$1"
fi

# Configuration
REGION="us-central1"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deploying Cloud Functions${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Validate required variables
if [ -z "$GCP_PROJECT_ID" ]; then
  echo -e "${RED}Error: GCP_PROJECT_ID is not set${NC}"
  exit 1
fi

if [ -z "$BACKEND_URL" ]; then
  echo -e "${RED}Error: BACKEND_URL is not set${NC}"
  echo -e "${YELLOW}Usage: ./deploy-cloud-functions.sh <backend-url>${NC}"
  echo -e "${YELLOW}   or: Set BACKEND_URL in .env${NC}"
  exit 1
fi

echo -e "${YELLOW}Project: $GCP_PROJECT_ID${NC}"
echo -e "${YELLOW}Region: $REGION${NC}"
echo -e "${YELLOW}Backend URL: $BACKEND_URL${NC}"
echo ""

# Set the project
gcloud config set project $GCP_PROJECT_ID

# ============================================
# Deploy graduation-evm
# ============================================
echo -e "${GREEN}Deploying graduation-evm...${NC}"

cd cloud-functions/graduation-evm

gcloud functions deploy graduation-evm \
  --gen2 \
  --runtime=nodejs20 \
  --region=$REGION \
  --source=. \
  --entry-point=graduateEvm \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --set-env-vars="RPC_URL=$RPC_URL,TOKEN_DISTRIBUTOR=$TOKEN_DISTRIBUTOR,BACKEND_URL=$BACKEND_URL" \
  --set-secrets="AUTOMATION_PRIVATE_KEY=automation-private-key:latest,GRADUATION_INTERNAL_SECRET=graduation-internal-secret:latest"

cd ../..

GRADUATION_EVM_URL=$(gcloud functions describe graduation-evm --region=$REGION --gen2 --format='value(serviceConfig.uri)' 2>/dev/null || echo "pending...")

echo ""
echo -e "${GREEN}graduation-evm deployed: ${YELLOW}$GRADUATION_EVM_URL${NC}"
echo ""

# ============================================
# Deploy graduation-solana
# ============================================
echo -e "${GREEN}Deploying graduation-solana...${NC}"

cd cloud-functions/graduation-solana

gcloud functions deploy graduation-solana \
  --gen2 \
  --runtime=nodejs20 \
  --region=$REGION \
  --source=. \
  --entry-point=graduateSolana \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --set-env-vars="SOLANA_RPC_URL=$SOLANA_RPC_URL,IAO_PROGRAM_ID=$IAO_PROGRAM_ID,BACKEND_URL=$BACKEND_URL" \
  --set-secrets="AUTOMATION_PRIVATE_KEY=automation-private-key-solana:latest,GRADUATION_INTERNAL_SECRET=graduation-internal-secret:latest"

cd ../..

GRADUATION_SOLANA_URL=$(gcloud functions describe graduation-solana --region=$REGION --gen2 --format='value(serviceConfig.uri)' 2>/dev/null || echo "pending...")

echo ""
echo -e "${GREEN}graduation-solana deployed: ${YELLOW}$GRADUATION_SOLANA_URL${NC}"
echo ""

# ============================================
# Deploy fee-distribution-evm
# ============================================
echo -e "${GREEN}Deploying fee-distribution-evm...${NC}"

cd cloud-functions/fee-distribution-evm

gcloud functions deploy fee-distribution-evm \
  --gen2 \
  --runtime=nodejs20 \
  --region=$REGION \
  --source=. \
  --entry-point=distributeFeesEvm \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --set-env-vars="RPC_URL=$RPC_URL,TOKEN_DISTRIBUTOR=$TOKEN_DISTRIBUTOR,BACKEND_URL=$BACKEND_URL" \
  --set-secrets="AUTOMATION_PRIVATE_KEY=automation-private-key:latest,FEE_DISTRIBUTION_SECRET=fee-distribution-secret:latest"

cd ../..

FEE_DIST_EVM_URL=$(gcloud functions describe fee-distribution-evm --region=$REGION --gen2 --format='value(serviceConfig.uri)' 2>/dev/null || echo "pending...")

echo ""
echo -e "${GREEN}fee-distribution-evm deployed: ${YELLOW}$FEE_DIST_EVM_URL${NC}"
echo ""

# ============================================
# Deploy fee-distribution-solana
# ============================================
echo -e "${GREEN}Deploying fee-distribution-solana...${NC}"

cd cloud-functions/fee-distribution-solana

gcloud functions deploy fee-distribution-solana \
  --gen2 \
  --runtime=nodejs20 \
  --region=$REGION \
  --source=. \
  --entry-point=distributeFeesSolana \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --set-env-vars="SOLANA_RPC_URL=$SOLANA_RPC_URL,IAO_PROGRAM_ID=$IAO_PROGRAM_ID,BACKEND_URL=$BACKEND_URL" \
  --set-secrets="AUTOMATION_PRIVATE_KEY=automation-private-key-solana:latest,FEE_DISTRIBUTION_SECRET=fee-distribution-secret:latest"

cd ../..

FEE_DIST_SOLANA_URL=$(gcloud functions describe fee-distribution-solana --region=$REGION --gen2 --format='value(serviceConfig.uri)' 2>/dev/null || echo "pending...")

echo ""
echo -e "${GREEN}fee-distribution-solana deployed: ${YELLOW}$FEE_DIST_SOLANA_URL${NC}"
echo ""

# ============================================
# Summary
# ============================================
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Cloud Functions Deployed!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "graduation-evm:          ${YELLOW}$GRADUATION_EVM_URL${NC}"
echo -e "graduation-solana:       ${YELLOW}$GRADUATION_SOLANA_URL${NC}"
echo -e "fee-distribution-evm:    ${YELLOW}$FEE_DIST_EVM_URL${NC}"
echo -e "fee-distribution-solana: ${YELLOW}$FEE_DIST_SOLANA_URL${NC}"
echo ""
echo -e "All functions will callback to: ${YELLOW}$BACKEND_URL${NC}"
