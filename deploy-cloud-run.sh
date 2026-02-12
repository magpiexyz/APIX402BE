#!/bin/bash
set -e

# ============================================
# Deploy Cloud Run Backend
# ============================================
# Outputs BACKEND_URL to stdout (last line) for use by other scripts
#
# Usage:
#   ./deploy-cloud-run.sh                # Remote build (Cloud Build) + deploy
#   ./deploy-cloud-run.sh --local-build  # Local Docker build + deploy
#   ./deploy-cloud-run.sh --no-build     # Deploy only (update env/secrets, use existing image)
#
# Prerequisites:
# - Run ./setup-secrets.sh first to create secrets
# - Fill in .env with correct values
# ============================================

# Parse arguments
SKIP_BUILD=false
LOCAL_BUILD=false
for arg in "$@"; do
  case $arg in
    --no-build)
      SKIP_BUILD=true
      shift
      ;;
    --local-build)
      LOCAL_BUILD=true
      shift
      ;;
  esac
done

# Load environment variables from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
else
  echo "Error: .env file not found" >&2
  exit 1
fi

# Configuration
REGION="us-central1"
CLOUD_RUN_SERVICE="apix-backend-v2"

# Colors for output (stderr so they don't interfere with URL output)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}" >&2
echo -e "${GREEN}Deploying Cloud Run Backend${NC}" >&2
echo -e "${GREEN}========================================${NC}" >&2
echo "" >&2

# Validate required variables
if [ -z "$GCP_PROJECT_ID" ]; then
  echo -e "${RED}Error: GCP_PROJECT_ID is not set${NC}" >&2
  exit 1
fi

echo -e "${YELLOW}Project: $GCP_PROJECT_ID${NC}" >&2
echo -e "${YELLOW}Region: $REGION${NC}" >&2
echo -e "${YELLOW}Service: $CLOUD_RUN_SERVICE${NC}" >&2
echo "" >&2

# Set the project
gcloud config set project $GCP_PROJECT_ID >&2

# Build the secrets string for Cloud Run
CLOUD_RUN_SECRETS="THIRDWEB_SECRET_KEY=thirdweb-secret-key:latest"
CLOUD_RUN_SECRETS="$CLOUD_RUN_SECRETS,BUILDER_SECRET_PHRASE=builder-secret-phrase:latest"
CLOUD_RUN_SECRETS="$CLOUD_RUN_SECRETS,ANTHROPIC_API_KEY=anthropic-api-key:latest"
CLOUD_RUN_SECRETS="$CLOUD_RUN_SECRETS,COMPANY_WALLET_PRIVATE_KEY=company-wallet-private-key:latest"
CLOUD_RUN_SECRETS="$CLOUD_RUN_SECRETS,GRADUATION_INTERNAL_SECRET=graduation-internal-secret:latest"
CLOUD_RUN_SECRETS="$CLOUD_RUN_SECRETS,CLOUDINARY_API_SECRET=cloudinary-api-secret:latest"
CLOUD_RUN_SECRETS="$CLOUD_RUN_SECRETS,FEE_DISTRIBUTION_SECRET=fee-distribution-secret:latest"

# Non-sensitive env vars for Cloud Run
CLOUD_RUN_ENV="NODE_ENV=production"
CLOUD_RUN_ENV="$CLOUD_RUN_ENV,GCP_PROJECT_ID=$GCP_PROJECT_ID"
CLOUD_RUN_ENV="$CLOUD_RUN_ENV,THIRDWEB_CLIENT_ID=$THIRDWEB_CLIENT_ID"
CLOUD_RUN_ENV="$CLOUD_RUN_ENV,THIRDWEB_SERVER_WALLET_ADDRESS=$THIRDWEB_SERVER_WALLET_ADDRESS"
CLOUD_RUN_ENV="$CLOUD_RUN_ENV,LLM_PROVIDER=$LLM_PROVIDER"
CLOUD_RUN_ENV="$CLOUD_RUN_ENV,LLM_MODEL=$LLM_MODEL"
CLOUD_RUN_ENV="$CLOUD_RUN_ENV,CLOUDINARY_CLOUD_NAME=$CLOUDINARY_CLOUD_NAME"
CLOUD_RUN_ENV="$CLOUD_RUN_ENV,CLOUDINARY_API_KEY=$CLOUDINARY_API_KEY"
CLOUD_RUN_ENV="$CLOUD_RUN_ENV,GRADUATION_FUNCTION_EVM_URL=$GRADUATION_FUNCTION_EVM_URL"
CLOUD_RUN_ENV="$CLOUD_RUN_ENV,GRADUATION_FUNCTION_SOLANA_URL=$GRADUATION_FUNCTION_SOLANA_URL"
CLOUD_RUN_ENV="$CLOUD_RUN_ENV,FEE_DISTRIBUTION_FUNCTION_EVM_URL=$FEE_DISTRIBUTION_FUNCTION_EVM_URL"
CLOUD_RUN_ENV="$CLOUD_RUN_ENV,FEE_DISTRIBUTION_FUNCTION_SOLANA_URL=$FEE_DISTRIBUTION_FUNCTION_SOLANA_URL"
CLOUD_RUN_ENV="$CLOUD_RUN_ENV,CLOUD_RUN_SERVICE_URL=$BACKEND_URL"

# Image configuration
REPO_NAME="apix-backend"
IMAGE_TAG="us-central1-docker.pkg.dev/$GCP_PROJECT_ID/$REPO_NAME/$CLOUD_RUN_SERVICE:latest"

# Build image (unless --no-build is specified)
if [ "$SKIP_BUILD" = false ]; then
  # Create Artifact Registry repository if not exists
  if ! gcloud artifacts repositories describe $REPO_NAME --location=us-central1 >/dev/null 2>&1; then
    echo -e "${YELLOW}Creating Artifact Registry repository...${NC}" >&2
    gcloud artifacts repositories create $REPO_NAME \
      --repository-format=docker \
      --location=us-central1 \
      --description="APIX Backend Docker images" >&2
  fi

  if [ "$LOCAL_BUILD" = true ]; then
    # Local Docker build
    echo -e "${YELLOW}Building Docker image locally...${NC}" >&2

    # Configure Docker authentication for Artifact Registry
    gcloud auth configure-docker us-central1-docker.pkg.dev --quiet >&2

    # Build locally (force amd64 for GCP Cloud Run)
    docker build --platform linux/amd64 -t "$IMAGE_TAG" . >&2

    # Push to Artifact Registry
    echo -e "${YELLOW}Pushing image to Artifact Registry...${NC}" >&2
    docker push "$IMAGE_TAG" >&2
  else
    # Remote Cloud Build (default)
    echo -e "${YELLOW}Building Docker image remotely (Cloud Build with Kaniko cache)...${NC}" >&2

    gcloud builds submit \
      --config=cloudbuild-image.yaml \
      --substitutions="_IMAGE_TAG=$IMAGE_TAG" \
      . >&2
  fi
else
  echo -e "${YELLOW}Skipping build (--no-build flag)${NC}" >&2
  echo -e "${YELLOW}Using existing image: $IMAGE_TAG${NC}" >&2
fi

echo -e "${YELLOW}Deploying to Cloud Run...${NC}" >&2

gcloud run deploy $CLOUD_RUN_SERVICE \
  --image "$IMAGE_TAG" \
  --region $REGION \
  --allow-unauthenticated \
  --min-instances=1 \
  --set-env-vars="$CLOUD_RUN_ENV" \
  --set-secrets="$CLOUD_RUN_SECRETS" >&2

# Get the Cloud Run URL
CLOUD_RUN_URL=$(gcloud run services describe $CLOUD_RUN_SERVICE --region=$REGION --format='value(status.url)')

# Update BACKEND_URL in .env if the file exists
if [ -f .env ]; then
  if grep -q "^BACKEND_URL=" .env; then
    # Update existing BACKEND_URL
    sed -i.bak "s|^BACKEND_URL=.*|BACKEND_URL=$CLOUD_RUN_URL|" .env && rm -f .env.bak
    echo -e "${GREEN}Updated BACKEND_URL in .env${NC}" >&2
  else
    # Append BACKEND_URL if not exists
    echo "BACKEND_URL=$CLOUD_RUN_URL" >> .env
    echo -e "${GREEN}Added BACKEND_URL to .env${NC}" >&2
  fi
fi

echo "" >&2
echo -e "${GREEN}========================================${NC}" >&2
echo -e "${GREEN}Cloud Run Deployed!${NC}" >&2
echo -e "${GREEN}========================================${NC}" >&2
echo -e "URL: ${YELLOW}$CLOUD_RUN_URL${NC}" >&2
echo "" >&2

# Output URL to stdout (for piping/capturing)
echo "$CLOUD_RUN_URL"
