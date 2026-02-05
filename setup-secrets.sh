#!/bin/bash
set -e

# ============================================
# APIX Secret Manager Setup Script
# ============================================
# This script creates/updates secrets in GCP Secret Manager
# based on the .env file. Run this when:
# - First time setup
# - Secrets need to be updated
# ============================================

# Load environment variables from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
else
  echo "Error: .env file not found"
  exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}APIX Secret Manager Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Validate required variables
if [ -z "$GCP_PROJECT_ID" ]; then
  echo -e "${RED}Error: GCP_PROJECT_ID is not set in .env${NC}"
  exit 1
fi

echo -e "${YELLOW}Project: $GCP_PROJECT_ID${NC}"
echo ""

# Set the project
gcloud config set project $GCP_PROJECT_ID

# ============================================
# Helper function to create or update secret
# ============================================
create_or_update_secret() {
  local SECRET_NAME=$1
  local SECRET_VALUE=$2

  # Skip if value is empty or placeholder
  if [ -z "$SECRET_VALUE" ] || \
     [ "$SECRET_VALUE" == "sk_your_thirdweb_secret_key" ] || \
     [ "$SECRET_VALUE" == "your-shared-secret-phrase" ] || \
     [ "$SECRET_VALUE" == "your-graduation-internal-secret" ] || \
     [[ "$SECRET_VALUE" == *"Your"* ]] || \
     [[ "$SECRET_VALUE" == *"your-"* ]]; then
    echo -e "${YELLOW}  Skipping $SECRET_NAME (placeholder or empty value)${NC}"
    return
  fi

  # Check if secret exists
  if gcloud secrets describe $SECRET_NAME --project=$GCP_PROJECT_ID > /dev/null 2>&1; then
    echo -e "  Updating secret: ${GREEN}$SECRET_NAME${NC}"
    echo -n "$SECRET_VALUE" | gcloud secrets versions add $SECRET_NAME --data-file=-
  else
    echo -e "  Creating secret: ${GREEN}$SECRET_NAME${NC}"
    echo -n "$SECRET_VALUE" | gcloud secrets create $SECRET_NAME --data-file=- --replication-policy=automatic
  fi
}

# ============================================
# Create/Update Secrets
# ============================================
echo -e "${GREEN}Creating/Updating secrets...${NC}"
echo ""

# Cloud Run secrets
echo "Cloud Run secrets:"
create_or_update_secret "thirdweb-secret-key" "$THIRDWEB_SECRET_KEY"
create_or_update_secret "builder-secret-phrase" "$BUILDER_SECRET_PHRASE"
create_or_update_secret "anthropic-api-key" "$ANTHROPIC_API_KEY"
create_or_update_secret "company-wallet-private-key" "$COMPANY_WALLET_PRIVATE_KEY"
create_or_update_secret "cloudinary-api-secret" "$CLOUDINARY_API_SECRET"
create_or_update_secret "graduation-internal-secret" "$GRADUATION_INTERNAL_SECRET"

echo ""
echo "Cloud Functions secrets:"
create_or_update_secret "automation-private-key" "$AUTOMATION_PRIVATE_KEY"
create_or_update_secret "automation-private-key-solana" "$AUTOMATION_PRIVATE_KEY_SOLANA"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Secrets setup complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "You can now run ./deploy-gcp.sh to deploy the services."
