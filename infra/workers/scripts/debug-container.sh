#!/bin/bash
# Debug container by checking stopped tasks and trying to understand why no logs

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
WORKER_TYPE="${2:-send}"  # send, scheduler, inbox-checker, or smartlead

REGION="${CDK_DEFAULT_REGION:-us-west-2}"
CLUSTER_NAME="furnace-cluster-$ENVIRONMENT"

echo "🔍 Debugging Container Issues"
echo "   Environment: $ENVIRONMENT"
echo "   Worker Type: $WORKER_TYPE"
echo ""

# Find the service (Smartlead runs as ad hoc tasks)
if [ "$WORKER_TYPE" = "smartlead" ]; then
  TASK_FAMILY="furnace-smartlead-migration-task-$ENVIRONMENT"
elif [ "$WORKER_TYPE" = "send" ]; then
  SERVICE_NAME=$(aws ecs list-services \
    --cluster "$CLUSTER_NAME" \
    --region "$REGION" \
    --query "serviceArns[?contains(@, 'SendWorker')]" \
    --output text 2>/dev/null | head -1 | awk -F'/' '{print $NF}')
elif [ "$WORKER_TYPE" = "inbox-checker" ]; then
  SERVICE_NAME=$(aws ecs list-services \
    --cluster "$CLUSTER_NAME" \
    --region "$REGION" \
    --query "serviceArns[?contains(@, 'InboxCheckerWorker')]" \
    --output text 2>/dev/null | head -1 | awk -F'/' '{print $NF}')
else
  SERVICE_NAME=$(aws ecs list-services \
    --cluster "$CLUSTER_NAME" \
    --region "$REGION" \
    --query "serviceArns[?contains(@, 'SchedulerWorker')]" \
    --output text 2>/dev/null | head -1 | awk -F'/' '{print $NF}')
fi

if [ "$WORKER_TYPE" != "smartlead" ] && { [ -z "$SERVICE_NAME" ] || [ "$SERVICE_NAME" = "None" ]; }; then
  echo "❌ Service not found"
  exit 1
fi

# Check stopped tasks for errors
echo "1️⃣  Checking recent stopped tasks for errors..."
if [ "$WORKER_TYPE" = "smartlead" ]; then
  STOPPED_TASKS=$(aws ecs list-tasks \
    --cluster "$CLUSTER_NAME" \
    --family "$TASK_FAMILY" \
    --desired-status STOPPED \
    --region "$REGION" \
    --max-items 5 \
    --query 'taskArns' \
    --output text)
else
  STOPPED_TASKS=$(aws ecs list-tasks \
    --cluster "$CLUSTER_NAME" \
    --service-name "$SERVICE_NAME" \
    --desired-status STOPPED \
    --region "$REGION" \
    --max-items 5 \
    --query 'taskArns' \
    --output text)
fi

if [ -n "$STOPPED_TASKS" ] && [ "$STOPPED_TASKS" != "None" ]; then
  echo "   Found stopped tasks, checking for exit codes..."
  echo ""
  
  for TASK_ARN in $STOPPED_TASKS; do
    TASK_ID=$(echo $TASK_ARN | awk -F'/' '{print $NF}')
    echo "   📋 Task: $TASK_ID"
    
    TASK_INFO=$(aws ecs describe-tasks \
      --cluster "$CLUSTER_NAME" \
      --tasks "$TASK_ARN" \
      --region "$REGION" \
      --query 'tasks[0]' \
      --output json)
    
    STOPPED_REASON=$(echo "$TASK_INFO" | jq -r '.stoppedReason // "Unknown"')
    STOP_CODE=$(echo "$TASK_INFO" | jq -r '.stopCode // "Unknown"')
    
    CONTAINERS=$(echo "$TASK_INFO" | jq -r '.containers[0]')
    EXIT_CODE=$(echo "$CONTAINERS" | jq -r '.exitCode // "N/A"')
    REASON=$(echo "$CONTAINERS" | jq -r '.reason // "N/A"')
    
    echo "      Exit Code: $EXIT_CODE"
    echo "      Stop Code: $STOP_CODE"
    echo "      Stopped Reason: $STOPPED_REASON"
    if [ "$REASON" != "N/A" ] && [ "$REASON" != "null" ]; then
      echo "      Container Reason: $REASON"
    fi
    echo ""
  done
else
  echo "   ✅ No recent stopped tasks found"
  echo ""
fi

# Check current running task
echo "2️⃣  Checking current running task..."
if [ "$WORKER_TYPE" = "smartlead" ]; then
  RUNNING_TASKS=$(aws ecs list-tasks \
    --cluster "$CLUSTER_NAME" \
    --family "$TASK_FAMILY" \
    --desired-status RUNNING \
    --region "$REGION" \
    --query 'taskArns[0]' \
    --output text)
else
  RUNNING_TASKS=$(aws ecs list-tasks \
    --cluster "$CLUSTER_NAME" \
    --service-name "$SERVICE_NAME" \
    --desired-status RUNNING \
    --region "$REGION" \
    --query 'taskArns[0]' \
    --output text)
fi

if [ -n "$RUNNING_TASKS" ] && [ "$RUNNING_TASKS" != "None" ]; then
  TASK_ID=$(echo $RUNNING_TASKS | awk -F'/' '{print $NF}')
  echo "   📋 Running Task: $TASK_ID"
  echo ""
  
  # Get task definition to check the command
  echo "3️⃣  Checking task definition..."
  TASK_INFO=$(aws ecs describe-tasks \
    --cluster "$CLUSTER_NAME" \
    --tasks "$RUNNING_TASKS" \
    --region "$REGION" \
    --query 'tasks[0]' \
    --output json)
  
  TASK_DEF_ARN=$(echo "$TASK_INFO" | jq -r '.taskDefinitionArn')
  echo "   Task Definition: $TASK_DEF_ARN"
  echo ""
  
  TASK_DEF=$(aws ecs describe-task-definition \
    --task-definition "$TASK_DEF_ARN" \
    --region "$REGION" \
    --query 'taskDefinition' \
    --output json)
  
  CONTAINER_DEF=$(echo "$TASK_DEF" | jq -r '.containerDefinitions[0]')
  CONTAINER_NAME=$(echo "$CONTAINER_DEF" | jq -r '.name')
  IMAGE=$(echo "$CONTAINER_DEF" | jq -r '.image')
  COMMAND=$(echo "$CONTAINER_DEF" | jq -r '.command // []')
  
  echo "   Container: $CONTAINER_NAME"
  echo "   Image: $IMAGE"
  if [ "$COMMAND" != "null" ] && [ -n "$COMMAND" ] && [ "$COMMAND" != "[]" ]; then
    echo "   Command: $COMMAND"
  else
    echo "   Command: (using image CMD)"
  fi
  echo ""
  
  # Check environment variables
  echo "4️⃣  Environment Variables:"
  ENV_VARS=$(echo "$CONTAINER_DEF" | jq -r '.environment[]? | "\(.name)=\(.value)"' | head -10)
  if [ -n "$ENV_VARS" ]; then
    echo "$ENV_VARS" | sed 's/^/   /'
    echo "   ..."
  else
    echo "   (none set)"
  fi
  echo ""
  
  # Check if log configuration is present
  echo "5️⃣  Log Configuration:"
  LOG_CONFIG=$(echo "$CONTAINER_DEF" | jq -r '.logConfiguration // {}')
  if [ "$LOG_CONFIG" != "{}" ] && [ -n "$LOG_CONFIG" ]; then
    LOG_DRIVER=$(echo "$LOG_CONFIG" | jq -r '.logDriver // "N/A"')
    echo "   Driver: $LOG_DRIVER"
    if [ "$LOG_DRIVER" = "awslogs" ]; then
      LOG_GROUP=$(echo "$LOG_CONFIG" | jq -r '.options."awslogs-group" // "N/A"')
      LOG_STREAM_PREFIX=$(echo "$LOG_CONFIG" | jq -r '.options."awslogs-stream-prefix" // "N/A"')
      LOG_REGION=$(echo "$LOG_CONFIG" | jq -r '.options."awslogs-region" // "N/A"')
      echo "   Log Group: $LOG_GROUP"
      echo "   Stream Prefix: $LOG_STREAM_PREFIX"
      echo "   Region: $LOG_REGION"
    fi
  else
    echo "   ⚠️  No log configuration found!"
  fi
else
  echo "   ⚠️  No running tasks found"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 Recommendations:"
echo ""
echo "   If exit codes are non-zero or tasks are stopping:"
echo "   1. Check if the Docker image exists in ECR"
echo "   2. Verify the image was built correctly"
echo "   3. Check if environment variables are set correctly"
echo ""
echo "   If tasks are running but no logs:"
if [ "$WORKER_TYPE" = "smartlead" ]; then
  echo "   1. Launch a fresh Smartlead migration run"
  echo "   2. Check CloudWatch logs immediately after launch"
  echo "   3. Verify IAM permissions for CloudWatch Logs"
else
  echo "   1. Restart the service to force a fresh start:"
  echo "      npm run restart:$ENVIRONMENT"
  echo "   2. Check CloudWatch logs immediately after restart"
  echo "   3. Verify IAM permissions for CloudWatch Logs"
fi
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
