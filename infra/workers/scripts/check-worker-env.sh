#!/bin/bash
# Check environment variables in running ECS tasks

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
WORKER_TYPE="${2:-scheduler}"

REGION="${CDK_DEFAULT_REGION:-us-west-2}"
CLUSTER_NAME="furnace-cluster-$ENVIRONMENT"

echo "🔍 Checking Environment Variables in Running Tasks"
echo "   Environment: $ENVIRONMENT"
echo "   Worker Type: $WORKER_TYPE"
echo "   Cluster: $CLUSTER_NAME"
echo ""

# Find the service
if [ "$WORKER_TYPE" = "send" ]; then
  SERVICE_NAME=$(aws ecs list-services \
    --cluster "$CLUSTER_NAME" \
    --region "$REGION" \
    --query "serviceArns[?contains(@, 'SendWorker')]" \
    --output text 2>/dev/null | head -1 | awk -F'/' '{print $NF}')
else
  SERVICE_NAME=$(aws ecs list-services \
    --cluster "$CLUSTER_NAME" \
    --region "$REGION" \
    --query "serviceArns[?contains(@, 'SchedulerWorker')]" \
    --output text 2>/dev/null | head -1 | awk -F'/' '{print $NF}')
fi

if [ -z "$SERVICE_NAME" ] || [ "$SERVICE_NAME" = "None" ]; then
  echo "❌ Service not found"
  exit 1
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

echo "📋 Task: $(echo $RUNNING_TASK | awk -F'/' '{print $NF}')"
echo ""

# Get task definition to see environment variables
TASK_INFO=$(aws ecs describe-tasks \
  --cluster "$CLUSTER_NAME" \
  --tasks "$RUNNING_TASK" \
  --region "$REGION" \
  --query 'tasks[0]' \
  --output json)

TASK_DEF_ARN=$(echo "$TASK_INFO" | jq -r '.taskDefinitionArn')

TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition "$TASK_DEF_ARN" \
  --region "$REGION" \
  --query 'taskDefinition.containerDefinitions[0].environment' \
  --output json)

echo "🔧 Environment Variables in Task Definition:"
echo "$TASK_DEF" | jq -r '.[] | "   \(.name)=\(.value)"' | grep -E "(SUPABASE_URL|AWS_REGION)" || echo "   (none found)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 From .env.local:"
echo "   DEV_SUPABASE_URL=${DEV_SUPABASE_URL}"
echo ""
echo "⚠️  If these don't match, you need to redeploy the stack:"
echo "   npm run deploy:$ENVIRONMENT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
