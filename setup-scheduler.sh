#!/bin/bash
set -e

# ============================================
# Setup Cloud Scheduler for Fee Distribution
# ============================================
# Creates Cloud Scheduler jobs that trigger the fee distribution
# endpoint on the Cloud Run backend. The backend fans out to
# both EVM and Solana cloud functions automatically.
#
# Usage:
#   ./setup-scheduler.sh              # Uses BACKEND_URL from .env
#   ./setup-scheduler.sh <backend-url> # Uses provided URL
#
# Options:
#   --delete    Delete existing scheduler jobs instead of creating
#   --list      List existing scheduler jobs
#
# Prerequisites:
# - Cloud Run backend must be deployed first
# - FEE_DISTRIBUTION_SECRET must be set in .env
# ============================================

# Load environment variables from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
fi

# Parse arguments
ACTION="create"
for arg in "$@"; do
  case $arg in
    --delete)
      ACTION="delete"
      shift
      ;;
    --list)
      ACTION="list"
      shift
      ;;
    *)
      if [[ ! "$arg" == --* ]]; then
        BACKEND_URL="$arg"
      fi
      shift
      ;;
  esac
done

# Configuration
REGION="us-central1"
JOB_NAME="fee-distribution-weekly"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Cloud Scheduler Setup - Fee Distribution${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Validate required variables
if [ -z "$GCP_PROJECT_ID" ]; then
  echo -e "${RED}Error: GCP_PROJECT_ID is not set${NC}"
  exit 1
fi

gcloud config set project $GCP_PROJECT_ID 2>/dev/null

# Handle --list
if [ "$ACTION" = "list" ]; then
  echo -e "${CYAN}Existing scheduler jobs:${NC}"
  echo ""
  gcloud scheduler jobs list --location=$REGION --format="table(name,schedule,state,httpTarget.uri)" 2>/dev/null || echo "No jobs found"
  exit 0
fi

# Handle --delete
if [ "$ACTION" = "delete" ]; then
  echo -e "${YELLOW}Deleting scheduler job: $JOB_NAME${NC}"
  gcloud scheduler jobs delete $JOB_NAME \
    --location=$REGION \
    --quiet 2>/dev/null && \
    echo -e "${GREEN}Deleted: $JOB_NAME${NC}" || \
    echo -e "${YELLOW}Job $JOB_NAME not found (nothing to delete)${NC}"
  exit 0
fi

# Validate required variables for create
if [ -z "$BACKEND_URL" ]; then
  echo -e "${RED}Error: BACKEND_URL is not set${NC}"
  echo -e "${YELLOW}Usage: ./setup-scheduler.sh <backend-url>${NC}"
  echo -e "${YELLOW}   or: Set BACKEND_URL in .env${NC}"
  exit 1
fi

if [ -z "$FEE_DISTRIBUTION_SECRET" ]; then
  echo -e "${RED}Error: FEE_DISTRIBUTION_SECRET is not set${NC}"
  echo -e "${YELLOW}Set FEE_DISTRIBUTION_SECRET in .env${NC}"
  exit 1
fi

echo -e "${YELLOW}Project:  $GCP_PROJECT_ID${NC}"
echo -e "${YELLOW}Region:   $REGION${NC}"
echo -e "${YELLOW}Backend:  $BACKEND_URL${NC}"
echo ""

# ============================================
# Create or update fee-distribution-weekly job
# ============================================
# Schedule: Every Sunday at 00:00 UTC
# The backend endpoint /internal/trigger-fee-distribution
# handles both EVM and Solana tokens automatically.
# ============================================

ENDPOINT="${BACKEND_URL}/internal/trigger-fee-distribution"
SCHEDULE="0 0 * * 0"

echo -e "${GREEN}Setting up: ${CYAN}$JOB_NAME${NC}"
echo -e "  Schedule:  ${YELLOW}$SCHEDULE${NC} (Every Sunday 00:00 UTC)"
echo -e "  Endpoint:  ${YELLOW}$ENDPOINT${NC}"
echo ""

# Delete existing job if it exists (update = delete + create)
gcloud scheduler jobs delete $JOB_NAME \
  --location=$REGION \
  --quiet 2>/dev/null || true

# Create the scheduler job
gcloud scheduler jobs create http $JOB_NAME \
  --location=$REGION \
  --schedule="$SCHEDULE" \
  --uri="$ENDPOINT" \
  --http-method=POST \
  --headers="Content-Type=application/json,X-Fee-Distribution-Secret=$FEE_DISTRIBUTION_SECRET" \
  --body='{}' \
  --time-zone="UTC" \
  --attempt-deadline="300s" \
  --description="Weekly fee distribution for all IAO tokens (EVM + Solana)"

echo ""
echo -e "${GREEN}Scheduler job created successfully!${NC}"
echo ""

# ============================================
# Summary
# ============================================
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Scheduler Setup Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Job:       ${CYAN}$JOB_NAME${NC}"
echo -e "Schedule:  ${YELLOW}Every Sunday 00:00 UTC${NC}"
echo -e "Endpoint:  ${YELLOW}$ENDPOINT${NC}"
echo -e "Auth:      ${YELLOW}X-Fee-Distribution-Secret header${NC}"
echo ""
echo -e "${CYAN}Useful commands:${NC}"
echo -e "  List jobs:     ${YELLOW}./setup-scheduler.sh --list${NC}"
echo -e "  Delete job:    ${YELLOW}./setup-scheduler.sh --delete${NC}"
echo -e "  Trigger now:   ${YELLOW}gcloud scheduler jobs run $JOB_NAME --location=$REGION${NC}"
echo -e "  View logs:     ${YELLOW}gcloud logging read 'resource.type=\"cloud_scheduler_job\"' --limit=20${NC}"
echo ""
