#!/bin/bash
set -e

# ============================================
# APIX Full Deployment Script
# ============================================
# Orchestrates deployment of all services:
# 1. Cloud Run backend
# 2. Cloud Functions (using Cloud Run URL)
#
# Usage:
#   ./deploy-gcp.sh              # Full build + deploy all
#   ./deploy-gcp.sh --no-build   # Deploy without rebuilding image
#
# Prerequisites:
# - Run ./setup-secrets.sh first to create secrets
# - Fill in .env with correct values
#
# Individual deployments:
# - ./deploy-cloud-run.sh              # Deploy Cloud Run only
# - ./deploy-cloud-run.sh --no-build   # Update env/secrets only
# - ./deploy-cloud-functions.sh        # Deploy Cloud Functions only
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Pass through arguments to deploy-cloud-run.sh
CLOUD_RUN_ARGS="$@"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}APIX Full GCP Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Step 1: Deploy Cloud Run and capture URL
echo -e "${YELLOW}Step 1: Deploying Cloud Run...${NC}"
echo ""

BACKEND_URL=$("$SCRIPT_DIR/deploy-cloud-run.sh" $CLOUD_RUN_ARGS)

echo ""
echo -e "${GREEN}Cloud Run URL captured: $BACKEND_URL${NC}"
echo ""

# Step 2: Deploy Cloud Functions with the URL
echo -e "${YELLOW}Step 2: Deploying Cloud Functions...${NC}"
echo ""

"$SCRIPT_DIR/deploy-cloud-functions.sh" "$BACKEND_URL"

# Summary
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Full Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Backend URL: ${YELLOW}$BACKEND_URL${NC}"
echo -e "${GREEN}(BACKEND_URL has been updated in .env)${NC}"
