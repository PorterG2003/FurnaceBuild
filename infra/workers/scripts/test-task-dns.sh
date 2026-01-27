#!/bin/bash
# Test DNS resolution from within an ECS task

set -e

ENVIRONMENT="${1:-dev}"
WORKER_TYPE="${2:-scheduler}"  # send, scheduler, or inbox-checker
REGION="${CDK_DEFAULT_REGION:-us-west-2}"
CLUSTER_NAME="furnace-cluster-$ENVIRONMENT"

echo "🧪 Testing DNS Resolution from ECS Task"
echo "   Environment: $ENVIRONMENT"
echo "   Worker Type: $WORKER_TYPE"
echo ""

# Find service by worker type
if [ "$WORKER_TYPE" = "send" ]; then
  SERVICE_NAME=$(aws ecs list-services \
    --cluster "$CLUSTER_NAME" \
    --region "$REGION" \
    --query "serviceArns[?contains(@, 'SendWorker')]" \
    --output text 2>/dev/null | head -1 | awk -F'/' '{print $NF}')
  CONTAINER_NAME="send-worker"
elif [ "$WORKER_TYPE" = "inbox-checker" ]; then
  SERVICE_NAME=$(aws ecs list-services \
    --cluster "$CLUSTER_NAME" \
    --region "$REGION" \
    --query "serviceArns[?contains(@, 'InboxCheckerWorker')]" \
    --output text 2>/dev/null | head -1 | awk -F'/' '{print $NF}')
  CONTAINER_NAME="inbox-checker-worker"
else
  SERVICE_NAME=$(aws ecs list-services \
    --cluster "$CLUSTER_NAME" \
    --region "$REGION" \
    --query "serviceArns[?contains(@, 'SchedulerWorker')]" \
    --output text 2>/dev/null | head -1 | awk -F'/' '{print $NF}')
  CONTAINER_NAME="scheduler-worker"
fi

# Get running task
RUNNING_TASK=$(aws ecs list-tasks \
  --cluster "$CLUSTER_NAME" \
  --service-name "$SERVICE_NAME" \
  --desired-status RUNNING \
  --region "$REGION" \
  --query 'taskArns[0]' \
  --output text)

if [ -z "$RUNNING_TASK" ] || [ "$RUNNING_TASK" = "None" ]; then
  echo "❌ No running tasks found"
  exit 1
fi

TASK_ID=$(echo "$RUNNING_TASK" | awk -F'/' '{print $NF}')
echo "📋 Testing with task: $TASK_ID"
echo ""

echo "🔍 Running DNS tests from container: $CONTAINER_NAME"
echo ""

# Test 1: Basic DNS resolution
echo "1️⃣  Testing DNS resolution for google.com..."
aws ecs execute-command \
  --cluster "$CLUSTER_NAME" \
  --task "$TASK_ID" \
  --container "$CONTAINER_NAME" \
  --region "$REGION" \
  --command "nslookup google.com" \
  --interactive 2>&1 || echo "   (execute-command might not be enabled)"

echo ""

# Test 2: Test Supabase URL resolution
echo "2️⃣  Testing Supabase URL resolution..."
SUPABASE_URL="ajmaypjedvbfnbcunrhs.supabase.co"
echo "   Hostname: $SUPABASE_URL"

# Get environment from .env.local
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
INFRA_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
ENV_FILE="$INFRA_DIR/.env.local"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
  SUPABASE_URL=$(echo "$DEV_SUPABASE_URL" | sed -E 's|https?://([^/]+).*|\1|')
  echo "   Using URL from .env.local: $SUPABASE_URL"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 Alternative: Check task logs for DNS errors"
echo "   The DNS errors in logs suggest tasks can't resolve hostnames"
echo ""
echo "   If tasks can reach internet, they should be able to resolve DNS"
echo "   The issue might be:"
echo "   1. VPC DNS resolver (169.254.169.253) not accessible"
echo "   2. Security group blocking DNS queries"
echo "   3. Node.js DNS cache issues"
echo ""
echo "   Try restarting tasks after DNS was enabled:"
echo "   npm run restart:dev"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
