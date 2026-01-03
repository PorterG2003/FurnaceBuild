#!/bin/bash

# Script to build and push Docker image to ECR
# Make sure you have ECR permissions first!

set -e

# Add Docker's bin directory to PATH for credential helper (macOS)
if [ -d "/Applications/Docker.app/Contents/Resources/bin" ]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi

REGION="us-west-2"
REPO_NAME="furnace/send-worker"
IMAGE_TAG="${1:-latest}"

# Get repository URI
echo "Getting ECR repository URI..."
REPO_URI=$(aws ecr describe-repositories \
  --repository-names "$REPO_NAME" \
  --region "$REGION" \
  --query 'repositories[0].repositoryUri' \
  --output text)

if [ -z "$REPO_URI" ]; then
  echo "❌ Repository not found. Make sure it exists."
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
  -f workers/send-worker/Dockerfile \
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

