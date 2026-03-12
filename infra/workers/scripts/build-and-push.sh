#!/bin/bash
# Build and push Docker images to ECR for workers

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
INFRA_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
PROJECT_ROOT="$( cd "$INFRA_DIR/../.." && pwd )"

# Load environment variables
ENV_FILE="$INFRA_DIR/.env.local"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# Parse arguments
ENVIRONMENT="${1:-dev}"
WORKER="${2:-all}"  # send-worker, scheduler-worker, inbox-checker-worker, smartlead-migration-task, or all

REGION="${CDK_DEFAULT_REGION:-us-west-2}"
ACCOUNT="${CDK_DEFAULT_ACCOUNT:-686255981838}"

# Validate environment
if [ "$ENVIRONMENT" != "dev" ] && [ "$ENVIRONMENT" != "prod" ]; then
  echo "❌ Error: Environment must be 'dev' or 'prod'"
  echo "Usage: $0 [dev|prod] [send-worker|scheduler-worker|inbox-checker-worker|smartlead-migration-task|all]"
  exit 1
fi

# Validate worker
if [ "$WORKER" != "send-worker" ] && [ "$WORKER" != "scheduler-worker" ] && [ "$WORKER" != "inbox-checker-worker" ] && [ "$WORKER" != "smartlead-migration-task" ] && [ "$WORKER" != "all" ]; then
  echo "❌ Error: Worker must be 'send-worker', 'scheduler-worker', 'inbox-checker-worker', 'smartlead-migration-task', or 'all'"
  echo "Usage: $0 [dev|prod] [send-worker|scheduler-worker|inbox-checker-worker|smartlead-migration-task|all]"
  exit 1
fi

# Capitalize first letter (dev -> Dev, prod -> Prod)
STACK_NAME="WorkerStack-$(echo "${ENVIRONMENT:0:1}" | tr '[:lower:]' '[:upper:]')${ENVIRONMENT:1}"

echo "🔨 Building and pushing Docker images"
echo "   Environment: $ENVIRONMENT"
echo "   Worker: $WORKER"
echo "   Region: $REGION"
echo ""

# Function to get ECR repository URI from CDK stack outputs or ECR query
get_repo_uri() {
  local repo_name="$1"
  
  # Try to get from CDK stack outputs first
  local output_key
  if [ "$repo_name" = "send-worker" ]; then
    output_key="SendWorkerRepoUri"
  elif [ "$repo_name" = "scheduler-worker" ]; then
    output_key="SchedulerWorkerRepoUri"
  elif [ "$repo_name" = "smartlead-migration-task" ]; then
    output_key="SmartleadMigrationTaskRepoUri"
  else
    output_key="InboxCheckerWorkerRepoUri"
  fi
  
  local repo_uri
  repo_uri=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
    --output text 2>/dev/null)
  
  # Fallback to querying ECR directly
  if [ -z "$repo_uri" ]; then
    echo "   Getting repository URI from ECR..."
    repo_uri=$(aws ecr describe-repositories \
      --repository-names "furnace/$repo_name-$ENVIRONMENT" \
      --region "$REGION" \
      --query 'repositories[0].repositoryUri' \
      --output text 2>/dev/null)
  fi
  
  if [ -z "$repo_uri" ] || [ "$repo_uri" = "None" ]; then
    echo "❌ Error: Could not find ECR repository: furnace/$repo_name-$ENVIRONMENT"
    echo "   Make sure the CDK stack is deployed: npm run deploy:$ENVIRONMENT"
    exit 1
  fi
  
  echo "$repo_uri"
}

# Function to build and push a single worker
build_and_push_worker() {
  local worker_name="$1"
  local repo_uri
  repo_uri=$(get_repo_uri "$worker_name")
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📦 $worker_name"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   Repository: $repo_uri"
  echo ""
  
  # Login to ECR (always login to ensure token is fresh)
  echo "🔐 Logging in to ECR..."
  aws ecr get-login-password --region "$REGION" | \
    docker login --username AWS --password-stdin "$repo_uri" > /dev/null 2>&1
  if [ $? -eq 0 ]; then
    echo "✅ Logged in to ECR"
  else
    echo "❌ Failed to login to ECR"
    exit 1
  fi
  echo ""
  
  # Set up buildx builder if it doesn't exist
  if ! docker buildx ls | grep -q "multiarch-builder"; then
    echo "🔧 Setting up Docker buildx builder..."
    docker buildx create --use --name multiarch-builder 2>/dev/null || docker buildx use multiarch-builder
    echo ""
  fi
  
  # Build image
  echo "🏗️  Building Docker image for linux/amd64 platform..."
  docker buildx build \
    --platform linux/amd64 \
    -f "$PROJECT_ROOT/workers/$worker_name/Dockerfile" \
    -t "$repo_uri:latest" \
    --load \
    "$PROJECT_ROOT"
  
  # Push image
  echo ""
  echo "📤 Pushing image to ECR..."
  docker push "$repo_uri:latest"
  
  echo ""
  echo "✅ Successfully pushed: $repo_uri:latest"
}

# Add Docker's bin directory to PATH for credential helper (macOS)
if [ -d "/Applications/Docker.app/Contents/Resources/bin" ]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi

# Build and push specified workers
if [ "$WORKER" = "all" ]; then
  build_and_push_worker "send-worker"
  build_and_push_worker "scheduler-worker"
  build_and_push_worker "inbox-checker-worker"
  build_and_push_worker "smartlead-migration-task"
else
  build_and_push_worker "$WORKER"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ All images built and pushed successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Next steps:"
echo "   Long-running workers:"
echo "   npm run scale:$ENVIRONMENT"
echo ""
echo "   Smartlead migration task:"
echo "   Deploy Amplify after infra/worker exports are available, then launch a migration run from the app."

