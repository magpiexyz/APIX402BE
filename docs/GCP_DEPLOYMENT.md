# GCP Deployment Guide

This guide covers deploying the APIX platform to Google Cloud Platform using Cloud Run for the backend and Firebase Hosting for the frontend.

## Prerequisites

### Required Tools
```bash
# Google Cloud CLI
curl https://sdk.cloud.google.com | bash
gcloud init

# Firebase CLI
npm install -g firebase-tools
firebase login

# Docker (for local testing)
# Install from https://docs.docker.com/get-docker/
```

### GCP Project Setup
1. Create a new GCP project or select an existing one
2. Enable required APIs:
```bash
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com
```

### Firebase Setup
```bash
# Initialize Firebase in your project
firebase init

# Select:
# - Firestore
# - Hosting
# - Emulators (optional, for local dev)
```

### Service Account
Create a service account for the backend:
```bash
# Create service account
gcloud iam service-accounts create apix-backend \
  --display-name="APIX Backend Service Account"

# Grant Firestore access
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:apix-backend@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Generate key file (for local development)
gcloud iam service-accounts keys create ./service-account.json \
  --iam-account=apix-backend@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

## Backend Deployment (Cloud Run)

### Environment Variables

Store secrets in Secret Manager:
```bash
# Create secrets
echo -n "your-thirdweb-secret" | gcloud secrets create THIRDWEB_SECRET_KEY --data-file=-
echo -n "your-wallet-address" | gcloud secrets create THIRDWEB_SERVER_WALLET_ADDRESS --data-file=-
echo -n "your-builder-secret" | gcloud secrets create BUILDER_SECRET_PHRASE --data-file=-
```

### Deploy from Source
```bash
cd /home/error0180/APIX402BE

# Deploy to Cloud Run
gcloud run deploy apix-backend \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=YOUR_PROJECT_ID" \
  --set-secrets "THIRDWEB_SECRET_KEY=THIRDWEB_SECRET_KEY:latest,THIRDWEB_SERVER_WALLET_ADDRESS=THIRDWEB_SERVER_WALLET_ADDRESS:latest,BUILDER_SECRET_PHRASE=BUILDER_SECRET_PHRASE:latest" \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10
```

### Deploy with Dockerfile
```dockerfile
# Dockerfile
FROM node:20-slim

WORKDIR /app

COPY package*.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

COPY . .
RUN yarn build

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080
CMD ["yarn", "start"]
```

```bash
# Build and deploy with Docker
gcloud run deploy apix-backend \
  --source . \
  --region us-central1 \
  --platform managed
```

### View Logs
```bash
# Stream logs
gcloud run services logs tail apix-backend --region us-central1

# Read recent logs
gcloud run services logs read apix-backend --region us-central1 --limit 100
```

### Update Deployment
```bash
# Update with new code
gcloud run deploy apix-backend --source . --region us-central1

# Update environment variables only
gcloud run services update apix-backend \
  --region us-central1 \
  --set-env-vars "NEW_VAR=value"
```

## Frontend Deployment (Firebase Hosting)

### Build for Production
```bash
cd /home/error0180/APIX402FE

# Install dependencies
npm install

# Set environment variables
echo "VITE_API_BASE_URL=https://apix-backend-xxxxx.run.app" > .env.production
echo "VITE_THIRDWEB_CLIENT_ID=your-client-id" >> .env.production

# Build
npm run build
```

### Firebase Configuration
```json
// firebase.json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ],
    "headers": [
      {
        "source": "**/*.@(js|css)",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "public, max-age=31536000, immutable"
          }
        ]
      }
    ]
  }
}
```

### Deploy
```bash
# Deploy to Firebase Hosting
firebase deploy --only hosting

# Deploy to specific site (if multiple sites)
firebase deploy --only hosting:apix-frontend
```

### Preview Deployment
```bash
# Create a preview channel
firebase hosting:channel:deploy preview --expires 7d
```

## CI/CD with Cloud Build

### Backend (cloudbuild.yaml)
```yaml
# cloudbuild.yaml in APIX402BE
steps:
  # Install dependencies
  - name: 'node:20'
    entrypoint: yarn
    args: ['install', '--frozen-lockfile']

  # Run tests
  - name: 'node:20'
    entrypoint: yarn
    args: ['test']

  # Build
  - name: 'node:20'
    entrypoint: yarn
    args: ['build']

  # Deploy to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'apix-backend'
      - '--source'
      - '.'
      - '--region'
      - 'us-central1'
      - '--allow-unauthenticated'

options:
  logging: CLOUD_LOGGING_ONLY

substitutions:
  _REGION: us-central1
```

### Frontend (cloudbuild.yaml)
```yaml
# cloudbuild.yaml in APIX402FE
steps:
  # Install dependencies
  - name: 'node:20'
    entrypoint: npm
    args: ['ci']

  # Build
  - name: 'node:20'
    entrypoint: npm
    args: ['run', 'build']
    env:
      - 'VITE_API_BASE_URL=${_API_URL}'

  # Deploy to Firebase
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: firebase
    args: ['deploy', '--only', 'hosting']

options:
  logging: CLOUD_LOGGING_ONLY

substitutions:
  _API_URL: https://apix-backend-xxxxx.run.app
```

### Set Up Triggers
```bash
# Connect repository
gcloud source repos create apix-backend
gcloud source repos clone apix-backend

# Create trigger for main branch
gcloud builds triggers create cloud-source-repositories \
  --repo=apix-backend \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml
```

## Custom Domain Setup

### Cloud Run Custom Domain
```bash
# Map custom domain
gcloud run domain-mappings create \
  --service apix-backend \
  --domain api.yourdomain.com \
  --region us-central1

# Get DNS records to configure
gcloud run domain-mappings describe \
  --domain api.yourdomain.com \
  --region us-central1
```

### Firebase Hosting Custom Domain
```bash
# Add custom domain via Firebase Console
# Or use CLI:
firebase hosting:sites:list
firebase hosting:channel:deploy production --site your-site-id
```

Then configure DNS:
1. Go to Firebase Console > Hosting
2. Click "Add custom domain"
3. Follow verification steps
4. Add A records as instructed

## Environment-Specific Deployments

### Staging Environment
```bash
# Deploy staging backend
gcloud run deploy apix-backend-staging \
  --source . \
  --region us-central1 \
  --set-env-vars "NODE_ENV=staging"

# Deploy staging frontend
firebase hosting:channel:deploy staging
```

### Production Environment
```bash
# Tag a release
git tag v1.0.0
git push origin v1.0.0

# Deploy production (via CI/CD or manually)
gcloud run deploy apix-backend \
  --source . \
  --region us-central1 \
  --set-env-vars "NODE_ENV=production" \
  --tag v1-0-0
```

## Monitoring & Debugging

### Cloud Run Metrics
```bash
# View service details
gcloud run services describe apix-backend --region us-central1

# View revisions
gcloud run revisions list --service apix-backend --region us-central1
```

### Firebase Hosting Analytics
- Access via Firebase Console > Hosting
- View bandwidth, requests, and response times

### Firestore Monitoring
```bash
# View Firestore usage
gcloud firestore operations list
```

## Rollback Procedures

### Cloud Run Rollback
```bash
# List revisions
gcloud run revisions list --service apix-backend --region us-central1

# Route traffic to previous revision
gcloud run services update-traffic apix-backend \
  --region us-central1 \
  --to-revisions=apix-backend-00001-abc=100
```

### Firebase Hosting Rollback
```bash
# List releases
firebase hosting:releases:list

# Rollback to previous release
firebase hosting:rollback
```

## Cost Optimization

### Cloud Run
- Set `--min-instances 0` for dev/staging
- Use `--cpu-throttling` for non-latency-sensitive workloads
- Review and adjust memory/CPU based on actual usage

### Firestore
- Use composite indexes wisely
- Implement caching to reduce reads
- Archive old data to reduce storage costs

### Firebase Hosting
- Enable caching headers for static assets
- Use CDN effectively with proper cache configuration
