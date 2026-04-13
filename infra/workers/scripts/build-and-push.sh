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
WORKER="${2:-all}"  # send-worker, scheduler-worker, inbox-checker-worker, smartlead-migration-task, utah-scraper, florida-scraper, website-verification, google-ads-verification, or all

REGION="${CDK_DEFAULT_REGION:-us-west-2}"
ACCOUNT="${CDK_DEFAULT_ACCOUNT:-686255981838}"

# Validate environment
if [ "$ENVIRONMENT" != "dev" ] && [ "$ENVIRONMENT" != "prod" ]; then
  echo "❌ Error: Environment must be 'dev' or 'prod'"
  echo "Usage: $0 [dev|prod] [send-worker|scheduler-worker|inbox-checker-worker|smartlead-migration-task|utah-scraper|florida-scraper|website-verification|google-ads-verification|all]"
  exit 1
fi

# Validate worker
if [ "$WORKER" != "send-worker" ] && [ "$WORKER" != "scheduler-worker" ] && [ "$WORKER" != "inbox-checker-worker" ] && [ "$WORKER" != "smartlead-migration-task" ] && [ "$WORKER" != "utah-scraper" ] && [ "$WORKER" != "florida-scraper" ] && [ "$WORKER" != "website-verification" ] && [ "$WORKER" != "google-ads-verification" ] && [ "$WORKER" != "all" ]; then
  echo "❌ Error: Worker must be 'send-worker', 'scheduler-worker', 'inbox-checker-worker', 'smartlead-migration-task', 'utah-scraper', 'florida-scraper', 'website-verification', 'google-ads-verification', or 'all'"
  echo "Usage: $0 [dev|prod] [send-worker|scheduler-worker|inbox-checker-worker|smartlead-migration-task|utah-scraper|florida-scraper|website-verification|google-ads-verification|all]"
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
  elif [ "$repo_name" = "utah-scraper" ]; then
    output_key="UtahScraperTaskRepoUri"
  elif [ "$repo_name" = "florida-scraper" ]; then
    output_key="FloridaScraperTaskRepoUri"
  elif [ "$repo_name" = "website-verification" ]; then
    output_key="WebsiteVerificationTaskRepoUri"
  elif [ "$repo_name" = "google-ads-verification" ]; then
    output_key="GoogleAdsVerificationTaskRepoUri"
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
    echo "   Getting repository URI from ECR..." >&2
    repo_uri=$(aws ecr describe-repositories \
      --repository-names "furnace/$repo_name-$ENVIRONMENT" \
      --region "$REGION" \
      --query 'repositories[0].repositoryUri' \
      --output text 2>/dev/null)
  fi
  
  if [ -z "$repo_uri" ] || [ "$repo_uri" = "None" ]; then
    echo "❌ Error: Could not find ECR repository: furnace/$repo_name-$ENVIRONMENT" >&2
    echo "   Make sure the CDK stack is deployed: npm run deploy:$ENVIRONMENT" >&2
    echo "   If the stack is UPDATE_ROLLBACK_COMPLETE, fix the stack then redeploy." >&2
    return 1
  fi
  
  echo "$repo_uri"
}

# Dockerfile path (state registry scrapers live under workers/state-scrapers/)
dockerfile_path_for_worker() {
  local worker_name="$1"
  case "$worker_name" in
    utah-scraper|florida-scraper)
      echo "$PROJECT_ROOT/workers/state-scrapers/$worker_name/Dockerfile"
      ;;
    website-verification)
      echo "$PROJECT_ROOT/workers/state-scrapers/website-verification-worker/Dockerfile"
      ;;
    google-ads-verification)
      echo "$PROJECT_ROOT/workers/state-scrapers/google-ads-verification-worker/Dockerfile"
      ;;
    *)
      echo "$PROJECT_ROOT/workers/$worker_name/Dockerfile"
      ;;
  esac
}

# Function to build and push a single worker
build_and_push_worker() {
  local worker_name="$1"
  local repo_uri
  if ! repo_uri=$(get_repo_uri "$worker_name"); then
    exit 1
  fi
  
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
  
  # Build and push in one step (--push). Using --load first fails on some Mac/Docker setups with
  # docker-container drivers: "failed to create temp dir ... read-only file system" during export.
  echo "🏗️  Building and pushing Docker image (linux/amd64) to ECR..."
  docker buildx build \
    --platform linux/amd64 \
    -f "$(dockerfile_path_for_worker "$worker_name")" \
    -t "$repo_uri:latest" \
    --push \
    "$PROJECT_ROOT"
  
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
  build_and_push_worker "utah-scraper"
  build_and_push_worker "florida-scraper"
  build_and_push_worker "website-verification"
  build_and_push_worker "google-ads-verification"
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

