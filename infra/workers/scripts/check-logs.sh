#!/bin/bash
# Check CloudWatch logs for a worker and verify log streams exist

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
WORKER_TYPE="${2:-send}"  # send, scheduler, or inbox-checker

REGION="${CDK_DEFAULT_REGION:-us-west-2}"
CLUSTER_NAME="furnace-cluster-$ENVIRONMENT"

if [ "$WORKER_TYPE" = "send" ]; then
  LOG_GROUP="/ecs/furnace/send-worker-$ENVIRONMENT"
elif [ "$WORKER_TYPE" = "inbox-checker" ]; then
  LOG_GROUP="/ecs/furnace/inbox-checker-worker-$ENVIRONMENT"
else
  LOG_GROUP="/ecs/furnace/scheduler-worker-$ENVIRONMENT"
fi

echo "🔍 Checking CloudWatch Logs"
echo "   Environment: $ENVIRONMENT"
echo "   Worker Type: $WORKER_TYPE"
echo "   Log Group: $LOG_GROUP"
echo "   Region: $REGION"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if log group exists
echo "1️⃣  Checking if log group exists..."
LOG_GROUP_EXISTS=$(aws logs describe-log-groups \
  --log-group-name-prefix "$LOG_GROUP" \
  --region "$REGION" \
  --query "logGroups[?logGroupName=='$LOG_GROUP'].logGroupName" \
  --output text 2>/dev/null || echo "None")

if [ "$LOG_GROUP_EXISTS" = "None" ] || [ -z "$LOG_GROUP_EXISTS" ]; then
  echo "   ❌ Log group not found: $LOG_GROUP"
  echo "   💡 This might mean the task hasn't created any log streams yet"
  echo "   💡 Or the log group wasn't created during deployment"
  echo ""
  exit 1
fi

echo "   ✅ Log group exists"
echo ""

# List log streams
echo "2️⃣  Listing log streams (last 10):"
LOG_STREAMS=$(aws logs describe-log-streams \
  --log-group-name "$LOG_GROUP" \
  --region "$REGION" \
  --order-by LastEventTime \
  --descending \
  --max-items 10 \
  --query 'logStreams[*].[logStreamName,lastEventTime,lastIngestionTime]' \
  --output text 2>/dev/null || echo "None")

if [ "$LOG_STREAMS" = "None" ] || [ -z "$LOG_STREAMS" ]; then
  echo "   ⚠️  No log streams found!"
  echo ""
  echo "   This could mean:"
  echo "   - The container hasn't written any logs yet"
  echo "   - The container is crashing before logging"
  echo "   - Logging is misconfigured"
  echo ""
  echo "   💡 Check task status with: npm run check:task $ENVIRONMENT $WORKER_TYPE"
  exit 1
fi

echo "$LOG_STREAMS" | while IFS=$'\t' read -r STREAM_NAME LAST_EVENT LAST_INGESTION; do
  if [ -n "$STREAM_NAME" ]; then
    # Convert epoch milliseconds to readable date
    if [ -n "$LAST_EVENT" ] && [ "$LAST_EVENT" != "None" ] && [ "$LAST_EVENT" != "0" ]; then
      EVENT_DATE=$(date -r $((LAST_EVENT / 1000)) '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "Unknown")
    else
      EVENT_DATE="Never"
    fi
    echo "   📝 $STREAM_NAME"
    echo "      Last Event: $EVENT_DATE"
  fi
done

echo ""

# Get recent logs from the most recent stream
echo "3️⃣  Recent logs from latest stream:"
LATEST_STREAM=$(aws logs describe-log-streams \
  --log-group-name "$LOG_GROUP" \
  --region "$REGION" \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --query 'logStreams[0].logStreamName' \
  --output text 2>/dev/null || echo "None")

if [ "$LATEST_STREAM" != "None" ] && [ -n "$LATEST_STREAM" ]; then
  echo "   Stream: $LATEST_STREAM"
  echo ""
  
  LOG_EVENTS=$(aws logs get-log-events \
    --log-group-name "$LOG_GROUP" \
    --log-stream-name "$LATEST_STREAM" \
    --region "$REGION" \
    --limit 20 \
    --query 'events[*].[timestamp,message]' \
    --output text 2>/dev/null || echo "None")
  
  if [ "$LOG_EVENTS" = "None" ] || [ -z "$LOG_EVENTS" ]; then
    echo "   ⚠️  No log events found in this stream"
  else
    echo "$LOG_EVENTS" | while IFS=$'\t' read -r TIMESTAMP MESSAGE; do
      if [ -n "$TIMESTAMP" ] && [ -n "$MESSAGE" ]; then
        LOG_DATE=$(date -r $((TIMESTAMP / 1000)) '+%H:%M:%S' 2>/dev/null || echo "Unknown")
        echo "   [$LOG_DATE] $MESSAGE"
      fi
    done
  fi
else
  echo "   ⚠️  Could not find latest stream"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 To follow logs in real-time:"
echo "   aws logs tail $LOG_GROUP --follow --region $REGION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
