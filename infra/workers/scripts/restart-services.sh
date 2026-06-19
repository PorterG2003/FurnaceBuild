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
TARGET="${2:-all}"

REGION="${CDK_DEFAULT_REGION:-us-west-2}"

# Validate environment
if [ "$ENVIRONMENT" != "dev" ] && [ "$ENVIRONMENT" != "prod" ]; then
  echo "❌ Error: Environment must be 'dev' or 'prod'"
  echo "Usage: $0 [dev|prod] [send-worker|scheduler-worker|inbox-checker-worker|all]"
  exit 1
fi

case "$TARGET" in
  ""|"all")
    TARGET="all"
    ;;
  "send"|"send-worker")
    TARGET="send-worker"
    ;;
  "scheduler"|"scheduler-worker")
    TARGET="scheduler-worker"
    ;;
  "inbox"|"inbox-checker"|"inbox-checker-worker")
    TARGET="inbox-checker-worker"
    ;;
  *)
    echo "❌ Error: Target must be 'send-worker', 'scheduler-worker', 'inbox-checker-worker', or 'all'"
    echo "Usage: $0 [dev|prod] [send-worker|scheduler-worker|inbox-checker-worker|all]"
    exit 1
    ;;
esac

CLUSTER_NAME="furnace-cluster-$ENVIRONMENT"

echo "🔄 Restarting ECS services"
echo "   Environment: $ENVIRONMENT"
echo "   Cluster: $CLUSTER_NAME"
echo "   Target: $TARGET"
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
  SEND_SERVICE_FULL=""
fi

if [ -z "$SCHEDULER_SERVICE_FULL" ] || [ "$SCHEDULER_SERVICE_FULL" = "None" ]; then
  SCHEDULER_SERVICE_FULL=""
fi

# Inbox checker is optional (may not exist in older deployments)
if [ -z "$INBOX_CHECKER_SERVICE_FULL" ] || [ "$INBOX_CHECKER_SERVICE_FULL" = "None" ]; then
  INBOX_CHECKER_SERVICE_FULL=""
fi

echo "   Found: Send=${SEND_SERVICE_FULL:-<not in cluster>} | Scheduler=${SCHEDULER_SERVICE_FULL:-<not in cluster>} | InboxChecker=${INBOX_CHECKER_SERVICE_FULL:-<not in cluster>}"
echo ""

require_service() {
  local service_name="$1"
  local service_label="$2"

  if [ -z "$service_name" ]; then
    echo "❌ Error: Could not find $service_label in cluster $CLUSTER_NAME"
    exit 1
  fi
}

get_desired_count() {
  local service_name="$1"
  aws ecs describe-services \
    --cluster "$CLUSTER_NAME" \
    --services "$service_name" \
    --region "$REGION" \
    --query 'services[0].desiredCount' \
    --output text 2>/dev/null || echo "?"
}

# Function to restart a service
restart_service() {
  local service_name="$1"
  local service_type="$2"
  local desired_count="$3"

  echo "🔄 Restarting $service_type ($service_name)..."

  if [ "$desired_count" = "0" ]; then
    echo "⚠️  $service_type is scaled to 0."
    echo "   Force-new-deployment will not start a new task while desired count is 0."
    echo "   Scale it up first: bash scripts/scale-services.sh $ENVIRONMENT 1 1 1"
    return
  fi

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

if [ "$TARGET" = "all" ] || [ "$TARGET" = "send-worker" ]; then
  require_service "$SEND_SERVICE_FULL" "SendWorkerService"
  SEND_DESIRED=$(get_desired_count "$SEND_SERVICE_FULL")
  restart_service "$SEND_SERVICE_FULL" "Send Worker Service" "$SEND_DESIRED"
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "scheduler-worker" ]; then
  require_service "$SCHEDULER_SERVICE_FULL" "SchedulerWorkerService"
  SCHEDULER_DESIRED=$(get_desired_count "$SCHEDULER_SERVICE_FULL")
  restart_service "$SCHEDULER_SERVICE_FULL" "Scheduler Worker Service" "$SCHEDULER_DESIRED"
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "inbox-checker-worker" ]; then
  require_service "$INBOX_CHECKER_SERVICE_FULL" "InboxCheckerWorkerService"
  DESIRED=$(get_desired_count "$INBOX_CHECKER_SERVICE_FULL")
  restart_service "$INBOX_CHECKER_SERVICE_FULL" "Inbox Checker Worker Service" "$DESIRED"
  if [ "$DESIRED" = "0" ]; then
    echo "   💡 Inbox checker desired count is 0 - no new task will start until you run: npm run scale:$ENVIRONMENT"
  fi
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

if [ "$TARGET" = "all" ] || [ "$TARGET" = "send-worker" ]; then
  echo "      # Send worker logs"
  echo "      aws logs tail /ecs/furnace/send-worker-$ENVIRONMENT --follow --region $REGION"
  echo ""
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "scheduler-worker" ]; then
  echo "      # Scheduler worker logs"
  echo "      aws logs tail /ecs/furnace/scheduler-worker-$ENVIRONMENT --follow --region $REGION"
  echo ""
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "inbox-checker-worker" ]; then
  echo "      # Inbox checker worker logs"
  echo "      aws logs tail /ecs/furnace/inbox-checker-worker-$ENVIRONMENT --follow --region $REGION"
  echo ""
fi

echo "   3. Look for:"
if [ "$TARGET" = "all" ] || [ "$TARGET" = "send-worker" ]; then
  echo "      ✅ 'Initializing send worker...' (no errors)"
fi
if [ "$TARGET" = "all" ] || [ "$TARGET" = "scheduler-worker" ]; then
  echo "      ✅ 'Initializing scheduler worker...' (no errors)"
fi
if [ "$TARGET" = "all" ] || [ "$TARGET" = "inbox-checker-worker" ]; then
  echo "      ✅ inbox checker startup logs without secret/config errors"
fi
echo "      ❌ Should NOT see: 'ParameterNotFound' or 'Failed to fetch secret'"
echo ""
echo "   4. Check task status:"
echo "      aws ecs list-tasks --cluster $CLUSTER_NAME --region $REGION"
echo ""
