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

# Get actual service names from ECS
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

if [ -z "$SEND_SERVICE_FULL" ] || [ "$SEND_SERVICE_FULL" = "None" ]; then
  echo "❌ Error: Could not find SendWorkerService in cluster $CLUSTER_NAME"
  exit 1
fi

if [ -z "$SCHEDULER_SERVICE_FULL" ] || [ "$SCHEDULER_SERVICE_FULL" = "None" ]; then
  echo "❌ Error: Could not find SchedulerWorkerService in cluster $CLUSTER_NAME"
  exit 1
fi

# Function to restart a service
restart_service() {
  local service_name="$1"
  local service_type="$2"
  
  echo "🔄 Restarting $service_type..."
  
  aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$service_name" \
    --force-new-deployment \
    --region "$REGION" \
    --output json > /dev/null
  
  if [ $? -eq 0 ]; then
    echo "✅ $service_type restarted (tasks will start with new configuration)"
  else
    echo "❌ Failed to restart $service_type"
    exit 1
  fi
}

# Restart send worker service
restart_service "$SEND_SERVICE_FULL" "Send Worker Service"

# Restart scheduler worker service
restart_service "$SCHEDULER_SERVICE_FULL" "Scheduler Worker Service"

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
echo "   3. Look for:"
echo "      ✅ 'Initializing send worker...' (no errors)"
echo "      ✅ 'Initializing scheduler worker...' (no errors)"
echo "      ❌ Should NOT see: 'ParameterNotFound' or 'Failed to fetch secret'"
echo ""
echo "   4. Check task status:"
echo "      aws ecs list-tasks --cluster $CLUSTER_NAME --region $REGION"
echo ""


