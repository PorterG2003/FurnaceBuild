#!/bin/bash
# Scale up ECS services to start tasks (after Docker images are pushed)

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
INFRA_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Load environment variables
ENV_FILE="$INFRA_DIR/.env.local"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# Parse arguments
ENVIRONMENT="${1:-dev}"
SEND_COUNT="${2:-1}"
SCHEDULER_COUNT="${3:-1}"
INBOX_CHECKER_COUNT="${4:-1}"

REGION="${CDK_DEFAULT_REGION:-us-west-2}"

# Validate environment
if [ "$ENVIRONMENT" != "dev" ] && [ "$ENVIRONMENT" != "prod" ]; then
  echo "❌ Error: Environment must be 'dev' or 'prod'"
  echo "Usage: $0 [dev|prod] [send-count] [scheduler-count]"
  exit 1
fi

CLUSTER_NAME="furnace-cluster-$ENVIRONMENT"

# Get actual service names from CloudFormation stack outputs or ECS
STACK_NAME="WorkerStack-$(echo "${ENVIRONMENT:0:1}" | tr '[:lower:]' '[:upper:]')${ENVIRONMENT:1}"

echo "🔍 Finding service names in cluster: $CLUSTER_NAME..."
echo "   Note: Services are isolated by cluster - dev and prod won't mix"
echo ""
SEND_SERVICE_FULL=$(aws ecs list-services \
  --cluster "$CLUSTER_NAME" \
  --region "$REGION" \
  --query "serviceArns[?contains(@, 'SendWorker')]" \
  --output text 2>/dev/null | head -1 | awk -F'/' '{print $NF}')

SCHEDULER_SERVICE_FULL=$(aws ecs list-services \
  --cluster "$CLUSTER_NAME" \
  --region "$REGION" \
  --query "serviceArns[?contains(@, 'SchedulerWorker')]" \
  --output text 2>/dev/null | head -1 | awk -F'/' '{print $NF}')

INBOX_CHECKER_SERVICE_FULL=$(aws ecs list-services \
  --cluster "$CLUSTER_NAME" \
  --region "$REGION" \
  --query "serviceArns[?contains(@, 'InboxCheckerWorker')]" \
  --output text 2>/dev/null | head -1 | awk -F'/' '{print $NF}')

if [ -z "$SEND_SERVICE_FULL" ] || [ "$SEND_SERVICE_FULL" = "None" ]; then
  echo "❌ Error: Could not find SendWorkerService in cluster $CLUSTER_NAME"
  echo "   Make sure the stack is deployed: npm run deploy:$ENVIRONMENT"
  exit 1
fi

if [ -z "$SCHEDULER_SERVICE_FULL" ] || [ "$SCHEDULER_SERVICE_FULL" = "None" ]; then
  echo "❌ Error: Could not find SchedulerWorkerService in cluster $CLUSTER_NAME"
  echo "   Make sure the stack is deployed: npm run deploy:$ENVIRONMENT"
  exit 1
fi

# Inbox checker is optional (may not exist in older deployments)
if [ -z "$INBOX_CHECKER_SERVICE_FULL" ] || [ "$INBOX_CHECKER_SERVICE_FULL" = "None" ]; then
  echo "⚠️  Warning: Could not find InboxCheckerWorkerService in cluster $CLUSTER_NAME"
  echo "   Skipping inbox checker worker scaling"
  INBOX_CHECKER_SERVICE_FULL=""
fi

SEND_SERVICE_NAME="$SEND_SERVICE_FULL"
SCHEDULER_SERVICE_NAME="$SCHEDULER_SERVICE_FULL"
INBOX_CHECKER_SERVICE_NAME="$INBOX_CHECKER_SERVICE_FULL"

echo "📈 Scaling ECS services"
echo "   Environment: $ENVIRONMENT"
echo "   Cluster: $CLUSTER_NAME"
echo "   Send Worker Service: $SEND_SERVICE_NAME"
echo "   Scheduler Worker Service: $SCHEDULER_SERVICE_NAME"
if [ -n "$INBOX_CHECKER_SERVICE_NAME" ]; then
  echo "   Inbox Checker Worker Service: $INBOX_CHECKER_SERVICE_NAME"
fi
echo "   Send Worker: $SEND_COUNT tasks"
echo "   Scheduler Worker: $SCHEDULER_COUNT tasks"
if [ -n "$INBOX_CHECKER_SERVICE_NAME" ]; then
  echo "   Inbox Checker Worker: $INBOX_CHECKER_COUNT tasks"
fi
echo ""

# Function to scale a service
scale_service() {
  local service_name="$1"
  local desired_count="$2"
  
  echo "🔄 Scaling $service_name to $desired_count tasks..."
  
  aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$service_name" \
    --desired-count "$desired_count" \
    --region "$REGION" \
    --output json > /dev/null
  
  if [ $? -eq 0 ]; then
    echo "✅ $service_name scaled to $desired_count"
  else
    echo "❌ Failed to scale $service_name"
    exit 1
  fi
}

# Scale send worker service
scale_service "$SEND_SERVICE_NAME" "$SEND_COUNT"

# Scale scheduler worker service
scale_service "$SCHEDULER_SERVICE_NAME" "$SCHEDULER_COUNT"

# Scale inbox checker worker service (if it exists)
if [ -n "$INBOX_CHECKER_SERVICE_NAME" ]; then
  scale_service "$INBOX_CHECKER_SERVICE_NAME" "$INBOX_CHECKER_COUNT"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Services scaled successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Next steps:"
echo "   1. Wait for tasks to start (usually 1-2 minutes)"
echo "   2. Check task status:"
echo "      aws ecs list-tasks --cluster $CLUSTER_NAME --region $REGION"
echo "   3. Check CloudWatch logs:"
echo "      aws logs tail /ecs/furnace/send-worker-$ENVIRONMENT --follow --region $REGION"
echo "      aws logs tail /ecs/furnace/scheduler-worker-$ENVIRONMENT --follow --region $REGION"
echo ""
echo "💡 To scale down (set to 0):"
echo "   bash scripts/scale-services.sh $ENVIRONMENT 0 0"

