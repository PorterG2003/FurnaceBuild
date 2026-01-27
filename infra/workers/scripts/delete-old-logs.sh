#!/bin/bash
# Delete old CloudWatch log groups

set -e

REGION="${CDK_DEFAULT_REGION:-us-west-2}"

echo "🗑️  Deleting Old CloudWatch Log Groups"
echo "   Region: $REGION"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚠️  WARNING: This will permanently delete log groups:"
echo "   - /ecs/furnace/send-worker"
echo "   - /ecs/furnace/scheduler-worker"
echo "   - /ecs/furnace/inbox-checker-worker"
echo ""
echo "All logs in these groups will be permanently deleted."
echo "Your new log groups (with -dev/-prod suffix) will NOT be affected."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "Are you sure you want to delete these log groups? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Cancelled."
  exit 0
fi

echo ""

LOG_GROUPS=(
  "/ecs/furnace/send-worker"
  "/ecs/furnace/scheduler-worker"
  "/ecs/furnace/inbox-checker-worker"
)

for LOG_GROUP in "${LOG_GROUPS[@]}"; do
  echo "🗑️  Deleting log group: $LOG_GROUP"
  
  # Check if log group exists
  EXISTS=$(aws logs describe-log-groups \
    --log-group-name-prefix "$LOG_GROUP" \
    --region "$REGION" \
    --query "logGroups[?logGroupName=='$LOG_GROUP'].logGroupName" \
    --output text 2>/dev/null || echo "")
  
  if [ -n "$EXISTS" ] && [ "$EXISTS" != "None" ]; then
    aws logs delete-log-group \
      --log-group-name "$LOG_GROUP" \
      --region "$REGION" \
      --output json > /dev/null
    
    echo "   ✅ Deleted: $LOG_GROUP"
  else
    echo "   ⚠️  Not found (may have been deleted already): $LOG_GROUP"
  fi
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Log groups deletion complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
