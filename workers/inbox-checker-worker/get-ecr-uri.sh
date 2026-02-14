#!/bin/bash

# Get ECR repository URI for pushing Docker images

REGION="us-west-2"
REPO_NAME="furnace/inbox-checker-worker"

echo "Getting ECR repository URI for environment: $ENVIRONMENT..."
echo ""

# Try CDK stack output first
STACK_NAME="WorkerStack-$(echo "${ENVIRONMENT:0:1}" | tr '[:lower:]' '[:upper:]')${ENVIRONMENT:1}"

REPO_URI=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='InboxCheckerWorkerRepoUri'].OutputValue" \
  --output text 2>/dev/null)

# Fallback to querying ECR directly
if [ -z "$REPO_URI" ] || [ "$REPO_URI" = "None" ]; then
  REPO_URI=$(aws ecr describe-repositories \
    --repository-names "$REPO_NAME" \
    --region "$REGION" \
    --query 'repositories[0].repositoryUri' \
    --output text 2>/dev/null)
fi

if [ -z "$REPO_URI" ] || [ "$REPO_URI" = "None" ]; then
  echo "❌ Repository not found: $REPO_NAME"
  echo "   Make sure it exists and you have permissions."
  echo "   Or deploy the CDK stack: cd infra/workers && npm run deploy:${ENVIRONMENT}"
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
echo "  docker build -f workers/inbox-checker-worker/Dockerfile -t $REPO_NAME:latest ."
echo ""
echo "  # Tag image"
echo "  docker tag $REPO_NAME:latest $REPO_URI:latest"
echo ""
echo "  # Push image"
echo "  docker push $REPO_URI:latest"
