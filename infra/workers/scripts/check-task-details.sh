#!/bin/bash
# Check detailed ECS task status and recent events

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
WORKER_TYPE="${2:-send}"  # send or scheduler

REGION="${CDK_DEFAULT_REGION:-us-west-2}"
CLUSTER_NAME="furnace-cluster-$ENVIRONMENT"

echo "🔍 Checking Task Details"
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

echo "📊 Service: $SERVICE_NAME"
echo ""

# Get running tasks
echo "1️⃣  Running Tasks:"
RUNNING_TASKS=$(aws ecs list-tasks \
  --cluster "$CLUSTER_NAME" \
  --service-name "$SERVICE_NAME" \
  --desired-status RUNNING \
  --region "$REGION" \
  --query 'taskArns' \
  --output text)

if [ -z "$RUNNING_TASKS" ] || [ "$RUNNING_TASKS" = "None" ]; then
  echo "   ⚠️  No running tasks found"
  echo ""
  
  # Check stopped tasks
  echo "2️⃣  Recent Stopped Tasks:"
  STOPPED_TASKS=$(aws ecs list-tasks \
    --cluster "$CLUSTER_NAME" \
    --service-name "$SERVICE_NAME" \
    --desired-status STOPPED \
    --region "$REGION" \
    --max-items 3 \
    --query 'taskArns' \
    --output text)
  
  if [ -n "$STOPPED_TASKS" ] && [ "$STOPPED_TASKS" != "None" ]; then
    for TASK_ARN in $STOPPED_TASKS; do
      echo ""
      echo "   📋 Task: $(echo $TASK_ARN | awk -F'/' '{print $NF}')"
      
      TASK_INFO=$(aws ecs describe-tasks \
        --cluster "$CLUSTER_NAME" \
        --tasks "$TASK_ARN" \
        --region "$REGION" \
        --query 'tasks[0]' \
        --output json)
      
      STOPPED_REASON=$(echo "$TASK_INFO" | jq -r '.stoppedReason // "Unknown"')
      STOP_CODE=$(echo "$TASK_INFO" | jq -r '.stopCode // "Unknown"')
      STOPPED_AT=$(echo "$TASK_INFO" | jq -r '.stoppedAt // "Unknown"')
      
      echo "      Stopped Reason: $STOPPED_REASON"
      echo "      Stop Code: $STOP_CODE"
      echo "      Stopped At: $STOPPED_AT"
      
      # Get container details
      CONTAINERS=$(echo "$TASK_INFO" | jq -r '.containers[]')
      if [ -n "$CONTAINERS" ]; then
        CONTAINER_NAME=$(echo "$CONTAINERS" | jq -r '.name')
        EXIT_CODE=$(echo "$CONTAINERS" | jq -r '.exitCode // "N/A"')
        REASON=$(echo "$CONTAINERS" | jq -r '.reason // "N/A"')
        
        echo "      Container: $CONTAINER_NAME"
        echo "      Exit Code: $EXIT_CODE"
        if [ "$REASON" != "N/A" ] && [ "$REASON" != "null" ]; then
          echo "      Reason: $REASON"
        fi
      fi
    done
  else
    echo "   ⚠️  No stopped tasks found"
  fi
else
  echo "   ✅ Found $(echo $RUNNING_TASKS | wc -w | tr -d ' ') running task(s)"
  echo ""
  
  # Get details of first running task
  FIRST_TASK=$(echo $RUNNING_TASKS | awk '{print $1}')
  echo "2️⃣  Task Details (first running task):"
  echo "   Task ARN: $(echo $FIRST_TASK | awk -F'/' '{print $NF}')"
  echo ""
  
  TASK_INFO=$(aws ecs describe-tasks \
    --cluster "$CLUSTER_NAME" \
    --tasks "$FIRST_TASK" \
    --region "$REGION" \
    --query 'tasks[0]' \
    --output json)
  
  LAST_STATUS=$(echo "$TASK_INFO" | jq -r '.lastStatus // "Unknown"')
  HEALTH_STATUS=$(echo "$TASK_INFO" | jq -r '.healthStatus // "Unknown"')
  CREATED_AT=$(echo "$TASK_INFO" | jq -r '.createdAt // "Unknown"')
  
  echo "   Status: $LAST_STATUS"
  echo "   Health: $HEALTH_STATUS"
  echo "   Created: $CREATED_AT"
  echo ""
  
  # Check container status
  echo "3️⃣  Container Status:"
  CONTAINERS=$(echo "$TASK_INFO" | jq -r '.containers[]')
  if [ -n "$CONTAINERS" ]; then
    CONTAINER_NAME=$(echo "$CONTAINERS" | jq -r '.name')
    CONTAINER_STATUS=$(echo "$CONTAINERS" | jq -r '.lastStatus // "Unknown"')
    CONTAINER_REASON=$(echo "$CONTAINERS" | jq -r '.reason // "N/A"')
    
    echo "   Name: $CONTAINER_NAME"
    echo "   Status: $CONTAINER_STATUS"
    if [ "$CONTAINER_REASON" != "N/A" ] && [ "$CONTAINER_REASON" != "null" ]; then
      echo "   Reason: $CONTAINER_REASON"
    fi
  fi
  echo ""
  
  # Get recent service events
  echo "4️⃣  Recent Service Events (last 10):"
  SERVICE_EVENTS=$(aws ecs describe-services \
    --cluster "$CLUSTER_NAME" \
    --services "$SERVICE_NAME" \
    --region "$REGION" \
    --query 'services[0].events[0:10]' \
    --output json)
  
  echo "$SERVICE_EVENTS" | jq -r '.[] | "   [\(.createdAt)] \(.message)"' | head -10
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 To check logs:"
if [ "$WORKER_TYPE" = "send" ]; then
  echo "   aws logs tail /ecs/furnace/send-worker-$ENVIRONMENT --follow --region $REGION"
else
  echo "   aws logs tail /ecs/furnace/scheduler-worker-$ENVIRONMENT --follow --region $REGION"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
