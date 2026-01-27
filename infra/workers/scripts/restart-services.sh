#!/bin/bash
# Force restart ECS services to pick up new secrets/environment variables

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

REGION="${CDK_DEFAULT_REGION:-us-west-2}"

# Validate environment
if [ "$ENVIRONMENT" != "dev" ] && [ "$ENVIRONMENT" != "prod" ]; then
  echo "❌ Error: Environment must be 'dev' or 'prod'"
  echo "Usage: $0 [dev|prod]"
  exit 1
fi

CLUSTER_NAME="furnace-cluster-$ENVIRONMENT"

echo "🔄 Restarting ECS services"
echo "   Environment: $ENVIRONMENT"
echo "   Cluster: $CLUSTER_NAME"
echo ""

# Get actual service names from ECS (--max-items 100 so inbox-checker isn't on a later page)
LIST_SERVICES_ARGS=(--cluster "$CLUSTER_NAME" --region "$REGION" --max-items 100)
SEND_SERVICE_FULL=$(aws ecs list-services "${LIST_SERVICES_ARGS[@]}" \
  --query "serviceArns[?contains(@, 'SendWorker')] | [0]" \
  --output text 2>/dev/null | awk -F'/' '{print $NF}')

SCHEDULER_SERVICE_FULL=$(aws ecs list-services "${LIST_SERVICES_ARGS[@]}" \
  --query "serviceArns[?contains(@, 'SchedulerWorker')] | [0]" \
  --output text 2>/dev/null | awk -F'/' '{print $NF}')

INBOX_CHECKER_SERVICE_FULL=$(aws ecs list-services "${LIST_SERVICES_ARGS[@]}" \
  --query "serviceArns[?contains(@, 'InboxCheckerWorker')] | [0]" \
  --output text 2>/dev/null | awk -F'/' '{print $NF}')

if [ -z "$SEND_SERVICE_FULL" ] || [ "$SEND_SERVICE_FULL" = "None" ]; then
  echo "❌ Error: Could not find SendWorkerService in cluster $CLUSTER_NAME"
  exit 1
fi

if [ -z "$SCHEDULER_SERVICE_FULL" ] || [ "$SCHEDULER_SERVICE_FULL" = "None" ]; then
  echo "❌ Error: Could not find SchedulerWorkerService in cluster $CLUSTER_NAME"
  exit 1
fi

# Inbox checker is optional (may not exist in older deployments)
if [ -z "$INBOX_CHECKER_SERVICE_FULL" ] || [ "$INBOX_CHECKER_SERVICE_FULL" = "None" ]; then
  INBOX_CHECKER_SERVICE_FULL=""
fi

echo "   Found: Send=$SEND_SERVICE_FULL | Scheduler=$SCHEDULER_SERVICE_FULL | InboxChecker=${INBOX_CHECKER_SERVICE_FULL:-<not in cluster>}"
echo ""

# Function to restart a service
restart_service() {
  local service_name="$1"
  local service_type="$2"
  
  echo "🔄 Restarting $service_type ($service_name)..."
  
  if ! aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$service_name" \
    --force-new-deployment \
    --region "$REGION" \
    --output json > /dev/null 2>&1; then
    echo "❌ Failed to restart $service_type"
    exit 1
  fi
  echo "✅ $service_type restarted (new tasks will roll out)"
}

# Restart send worker service
restart_service "$SEND_SERVICE_FULL" "Send Worker Service"

# Restart scheduler worker service
restart_service "$SCHEDULER_SERVICE_FULL" "Scheduler Worker Service"

# Restart inbox checker worker service (if it exists in cluster)
if [ -n "$INBOX_CHECKER_SERVICE_FULL" ] && [ "$INBOX_CHECKER_SERVICE_FULL" != "None" ]; then
  restart_service "$INBOX_CHECKER_SERVICE_FULL" "Inbox Checker Worker Service"
  DESIRED=$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$INBOX_CHECKER_SERVICE_FULL" --region "$REGION" --query 'services[0].desiredCount' --output text 2>/dev/null || echo "?")
  if [ "$DESIRED" = "0" ]; then
    echo "   💡 Inbox checker desired count is 0 — no new task will start until you run: npm run scale:$ENVIRONMENT"
  fi
else
  echo "⚠️  Inbox checker service not found in cluster — skipping. (Ensure stack includes inbox-checker and deploy: npm run deploy:$ENVIRONMENT)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Services restarted successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Next steps:"
echo "   1. Wait 30-60 seconds for new tasks to start"
echo "   2. Check CloudWatch logs to verify workers connect successfully:"
echo ""
echo "      # Send worker logs"
echo "      aws logs tail /ecs/furnace/send-worker-$ENVIRONMENT --follow --region $REGION"
echo ""
echo "      # Scheduler worker logs"
echo "      aws logs tail /ecs/furnace/scheduler-worker-$ENVIRONMENT --follow --region $REGION"
echo ""
echo "      # Inbox checker worker logs"
echo "      aws logs tail /ecs/furnace/inbox-checker-worker-$ENVIRONMENT --follow --region $REGION"
echo ""
echo "   3. Look for:"
echo "      ✅ 'Initializing send worker...' (no errors)"
echo "      ✅ 'Initializing scheduler worker...' (no errors)"
echo "      ❌ Should NOT see: 'ParameterNotFound' or 'Failed to fetch secret'"
echo ""
echo "   4. Check task status:"
echo "      aws ecs list-tasks --cluster $CLUSTER_NAME --region $REGION"
echo ""


