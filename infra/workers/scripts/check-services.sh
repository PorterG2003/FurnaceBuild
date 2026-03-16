#!/bin/bash
# Check ECS service status and diagnose issues

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

echo "🔍 Checking ECS Services Status"
echo "   Environment: $ENVIRONMENT"
echo "   Cluster: $CLUSTER_NAME"
echo "   Region: $REGION"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if cluster exists
echo "1️⃣  Checking if cluster exists..."
CLUSTER_EXISTS=$(aws ecs describe-clusters \
  --clusters "$CLUSTER_NAME" \
  --region "$REGION" \
  --query 'clusters[0].clusterName' \
  --output text 2>/dev/null || echo "None")

if [ "$CLUSTER_EXISTS" = "None" ] || [ -z "$CLUSTER_EXISTS" ]; then
  echo "❌ Cluster '$CLUSTER_NAME' not found!"
  echo "   Deploy the stack first: npm run deploy:$ENVIRONMENT"
  exit 1
fi
echo "✅ Cluster exists: $CLUSTER_NAME"
echo ""

# Get service names
echo "2️⃣  Finding services..."
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
  echo "❌ SendWorkerService not found in cluster"
  exit 1
fi

if [ -z "$SCHEDULER_SERVICE_FULL" ] || [ "$SCHEDULER_SERVICE_FULL" = "None" ]; then
  echo "❌ SchedulerWorkerService not found in cluster"
  exit 1
fi

echo "✅ Send Worker Service: $SEND_SERVICE_FULL"
echo "✅ Scheduler Worker Service: $SCHEDULER_SERVICE_FULL"
echo ""

echo "2️⃣b️⃣  Smartlead Task Definition..."
SMARTLEAD_TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition "furnace-smartlead-migration-task-$ENVIRONMENT" \
  --region "$REGION" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text 2>/dev/null || echo "None")

if [ "$SMARTLEAD_TASK_DEF" = "None" ] || [ -z "$SMARTLEAD_TASK_DEF" ]; then
  echo "❌ Smartlead migration task definition not found"
  exit 1
fi

echo "✅ Smartlead task definition: $SMARTLEAD_TASK_DEF"
echo ""

# Function to check service status
check_service() {
  local service_name="$1"
  local worker_type="$2"
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📊 $worker_type Service Status"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  SERVICE_INFO=$(aws ecs describe-services \
    --cluster "$CLUSTER_NAME" \
    --services "$service_name" \
    --region "$REGION" \
    --query 'services[0]' \
    --output json)
  
  DESIRED_COUNT=$(echo "$SERVICE_INFO" | jq -r '.desiredCount')
  RUNNING_COUNT=$(echo "$SERVICE_INFO" | jq -r '.runningCount')
  PENDING_COUNT=$(echo "$SERVICE_INFO" | jq -r '.pendingCount')
  STATUS=$(echo "$SERVICE_INFO" | jq -r '.status')
  
  echo "   Service: $service_name"
  echo "   Status: $STATUS"
  echo "   Desired: $DESIRED_COUNT"
  echo "   Running: $RUNNING_COUNT"
  echo "   Pending: $PENDING_COUNT"
  echo ""
  
  if [ "$DESIRED_COUNT" -eq 0 ]; then
    echo "   ⚠️  Desired count is 0 - services are scaled down"
    echo "   💡 To scale up: npm run scale:$ENVIRONMENT"
    echo ""
    return
  fi
  
  if [ "$RUNNING_COUNT" -eq 0 ] && [ "$PENDING_COUNT" -eq 0 ]; then
    echo "   ❌ No tasks running or pending!"
    echo ""
    
    # Check stopped tasks for errors
    echo "   🔍 Checking stopped tasks for errors..."
    STOPPED_TASKS=$(aws ecs list-tasks \
      --cluster "$CLUSTER_NAME" \
      --service-name "$service_name" \
      --desired-status STOPPED \
      --region "$REGION" \
      --max-items 1 \
      --query 'taskArns[0]' \
      --output text 2>/dev/null || echo "None")
    
    if [ "$STOPPED_TASKS" != "None" ] && [ -n "$STOPPED_TASKS" ]; then
      TASK_INFO=$(aws ecs describe-tasks \
        --cluster "$CLUSTER_NAME" \
        --tasks "$STOPPED_TASKS" \
        --region "$REGION" \
        --query 'tasks[0]' \
        --output json)
      
      STOPPED_REASON=$(echo "$TASK_INFO" | jq -r '.stoppedReason // "Unknown"')
      STOP_CODE=$(echo "$TASK_INFO" | jq -r '.stopCode // "Unknown"')
      
      echo "   📋 Last stopped task:"
      echo "      Reason: $STOPPED_REASON"
      echo "      Code: $STOP_CODE"
      echo ""
      
      # Check container exit code
      CONTAINERS=$(echo "$TASK_INFO" | jq -r '.containers[] | "\(.name): exit \(.exitCode // "N/A")"')
      if [ -n "$CONTAINERS" ]; then
        echo "   📦 Container exit codes:"
        echo "$CONTAINERS" | sed 's/^/      /'
        echo ""
      fi
    fi
  elif [ "$PENDING_COUNT" -gt 0 ]; then
    echo "   ⏳ Tasks are pending (starting up)..."
    echo ""
    
    # Check pending tasks
    PENDING_TASKS=$(aws ecs list-tasks \
      --cluster "$CLUSTER_NAME" \
      --service-name "$service_name" \
      --desired-status RUNNING \
      --region "$REGION" \
      --max-items 1 \
      --query 'taskArns[0]' \
      --output text 2>/dev/null || echo "None")
    
    if [ "$PENDING_TASKS" != "None" ] && [ -n "$PENDING_TASKS" ]; then
      TASK_INFO=$(aws ecs describe-tasks \
        --cluster "$CLUSTER_NAME" \
        --tasks "$PENDING_TASKS" \
        --region "$REGION" \
        --query 'tasks[0]' \
        --output json)
      
      LAST_STATUS=$(echo "$TASK_INFO" | jq -r '.lastStatus // "Unknown"')
      STOPPED_REASON=$(echo "$TASK_INFO" | jq -r '.stoppedReason // "N/A"')
      
      echo "   📋 Task status: $LAST_STATUS"
      if [ "$STOPPED_REASON" != "N/A" ] && [ "$STOPPED_REASON" != "null" ]; then
        echo "   ⚠️  Stopped reason: $STOPPED_REASON"
      fi
      echo ""
      
      # Check why task is pending
      STOP_CODE=$(echo "$TASK_INFO" | jq -r '.stopCode // "null"')
      if [ "$STOP_CODE" != "null" ]; then
        echo "   ❌ Task stopped with code: $STOP_CODE"
        echo ""
      fi
    fi
  fi
  
  if [ "$RUNNING_COUNT" -gt 0 ]; then
    echo "   ✅ $RUNNING_COUNT task(s) running"
    echo ""
  fi
}

# Check all services
check_service "$SEND_SERVICE_FULL" "Send Worker"
check_service "$SCHEDULER_SERVICE_FULL" "Scheduler Worker"
if [ -n "$INBOX_CHECKER_SERVICE_FULL" ] && [ "$INBOX_CHECKER_SERVICE_FULL" != "None" ]; then
  check_service "$INBOX_CHECKER_SERVICE_FULL" "Inbox Checker Worker"
fi

# Summary and recommendations
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 Recommendations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if Docker images exist in ECR
echo "3️⃣  Checking Docker images in ECR..."
SEND_REPO="furnace/send-worker-$ENVIRONMENT"
SCHEDULER_REPO="furnace/scheduler-worker-$ENVIRONMENT"
SMARTLEAD_REPO="furnace/smartlead-migration-task-$ENVIRONMENT"

SEND_IMAGE_EXISTS=$(aws ecr describe-images \
  --repository-name "$SEND_REPO" \
  --region "$REGION" \
  --query 'imageDetails[0].imageTags[0]' \
  --output text 2>/dev/null || echo "None")

SCHEDULER_IMAGE_EXISTS=$(aws ecr describe-images \
  --repository-name "$SCHEDULER_REPO" \
  --region "$REGION" \
  --query 'imageDetails[0].imageTags[0]' \
  --output text 2>/dev/null || echo "None")

SMARTLEAD_IMAGE_EXISTS=$(aws ecr describe-images \
  --repository-name "$SMARTLEAD_REPO" \
  --region "$REGION" \
  --query 'imageDetails[0].imageTags[0]' \
  --output text 2>/dev/null || echo "None")

if [ "$SEND_IMAGE_EXISTS" = "None" ] || [ -z "$SEND_IMAGE_EXISTS" ]; then
  echo "   ❌ No Docker images found in ECR for send-worker"
  echo "   💡 Build and push: npm run build:$ENVIRONMENT"
else
  echo "   ✅ Send worker image found: $SEND_IMAGE_EXISTS"
fi

if [ "$SCHEDULER_IMAGE_EXISTS" = "None" ] || [ -z "$SCHEDULER_IMAGE_EXISTS" ]; then
  echo "   ❌ No Docker images found in ECR for scheduler-worker"
  echo "   💡 Build and push: npm run build:$ENVIRONMENT"
else
  echo "   ✅ Scheduler worker image found: $SCHEDULER_IMAGE_EXISTS"
fi

if [ "$SMARTLEAD_IMAGE_EXISTS" = "None" ] || [ -z "$SMARTLEAD_IMAGE_EXISTS" ]; then
  echo "   ❌ No Docker images found in ECR for smartlead-migration-task"
  echo "   💡 Build and push: npm run build:$ENVIRONMENT or npm run build:$ENVIRONMENT:smartlead"
else
  echo "   ✅ Smartlead migration task image found: $SMARTLEAD_IMAGE_EXISTS"
fi
echo ""

echo "4️⃣  Recent Smartlead Tasks"
SMARTLEAD_TASKS=$(aws ecs list-tasks \
  --cluster "$CLUSTER_NAME" \
  --family "furnace-smartlead-migration-task-$ENVIRONMENT" \
  --desired-status RUNNING \
  --region "$REGION" \
  --query 'taskArns' \
  --output text 2>/dev/null || echo "None")

if [ "$SMARTLEAD_TASKS" = "None" ] || [ -z "$SMARTLEAD_TASKS" ]; then
  echo "   ℹ️  No running Smartlead migration tasks right now"
else
  echo "   ✅ Running Smartlead task(s): $(echo $SMARTLEAD_TASKS | wc -w | tr -d ' ')"
fi
echo ""

# Check CloudWatch logs
echo "5️⃣  CloudWatch Logs"
echo "   View logs:"
echo "   aws logs tail /ecs/furnace/send-worker-$ENVIRONMENT --follow --region $REGION"
echo "   aws logs tail /ecs/furnace/scheduler-worker-$ENVIRONMENT --follow --region $REGION"
echo "   aws logs tail /ecs/furnace/inbox-checker-worker-$ENVIRONMENT --follow --region $REGION"
echo "   aws logs tail /ecs/furnace/smartlead-migration-task-$ENVIRONMENT --follow --region $REGION"
echo "   Or: npm run check:logs -- $ENVIRONMENT <send|scheduler|inbox-checker|smartlead>"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
