#!/bin/bash

# Script to build and push Docker image to ECR
# Make sure you have ECR permissions first!

set -e

# Add Docker's bin directory to PATH for credential helper (macOS)
if [ -d "/Applications/Docker.app/Contents/Resources/bin" ]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi

REGION="us-west-2"
ENVIRONMENT="${1:-dev}"  # First arg is environment (dev/prod)
IMAGE_TAG="${2:-latest}"  # Second arg is image tag
REPO_NAME="furnace/inbox-checker-worker-${ENVIRONMENT}"

# Get repository URI (try CDK stack output first, then ECR)
echo "Getting ECR repository URI..."
STACK_NAME="WorkerStack-$(echo "${ENVIRONMENT:0:1}" | tr '[:lower:]' '[:upper:]')${ENVIRONMENT:1}"

REPO_URI=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='InboxCheckerWorkerRepoUri'].OutputValue" \
  --output text 2>/dev/null)

# Fallback to querying ECR directly
if [ -z "$REPO_URI" ] || [ "$REPO_URI" = "None" ]; then
  echo "   Getting repository URI from ECR..."
  REPO_URI=$(aws ecr describe-repositories \
    --repository-names "$REPO_NAME" \
    --region "$REGION" \
    --query 'repositories[0].repositoryUri' \
    --output text 2>/dev/null)
fi

if [ -z "$REPO_URI" ] || [ "$REPO_URI" = "None" ]; then
  echo "❌ Repository not found: $REPO_NAME"
  echo "   Make sure the CDK stack is deployed: cd infra/workers && npm run deploy:${ENVIRONMENT}"
  exit 1
fi

echo "Repository URI: $REPO_URI"
echo ""

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$REPO_URI"

# Set up buildx builder if it doesn't exist
echo ""
echo "Setting up Docker buildx builder..."
docker buildx create --use --name multiarch-builder 2>/dev/null || docker buildx use multiarch-builder

# Build image (from repo root)
# IMPORTANT: Build for linux/amd64 platform (ECS Fargate requirement)
echo ""
echo "Building Docker image for linux/amd64 platform..."
docker buildx build \
  --platform linux/amd64 \
  -f workers/inbox-checker-worker/Dockerfile \
  -t "$REPO_NAME:$IMAGE_TAG" \
  -t "$REPO_URI:$IMAGE_TAG" \
  -t "$REPO_URI:latest" \
  --load \
  .

# Push image
echo ""
echo "Pushing image to ECR..."
docker push "$REPO_URI:$IMAGE_TAG"
docker push "$REPO_URI:latest"

echo ""
echo "✅ Successfully pushed image: $REPO_URI:$IMAGE_TAG"
echo "   Latest tag: $REPO_URI:latest"
