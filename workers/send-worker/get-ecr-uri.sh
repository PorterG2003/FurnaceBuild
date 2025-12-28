#!/bin/bash

# Get ECR repository URI for pushing Docker images

REGION="us-west-2"
REPO_NAME="furnace/send-worker"

echo "Getting ECR repository URI..."
echo ""

REPO_URI=$(aws ecr describe-repositories \
  --repository-names "$REPO_NAME" \
  --region "$REGION" \
  --query 'repositories[0].repositoryUri' \
  --output text 2>/dev/null)

if [ -z "$REPO_URI" ]; then
  echo "❌ Repository not found. Make sure it exists and you have permissions."
  exit 1
fi

echo "✅ Repository URI:"
echo "$REPO_URI"
echo ""
echo "Use this URI to tag and push Docker images:"
echo ""
echo "  # Login to ECR"
echo "  aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REPO_URI"
echo ""
echo "  # Build image"
echo "  docker build -f workers/send-worker/Dockerfile -t $REPO_NAME:latest ."
echo ""
echo "  # Tag image"
echo "  docker tag $REPO_NAME:latest $REPO_URI:latest"
echo ""
echo "  # Push image"
echo "  docker push $REPO_URI:latest"

