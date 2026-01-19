#!/bin/bash
# Safely delete old ECS cluster from Amplify setup

set -e

REGION="${CDK_DEFAULT_REGION:-us-west-2}"
OLD_CLUSTER="furnace-cluster"

echo "🗑️  Deleting Old ECS Cluster: $OLD_CLUSTER"
echo "   Region: $REGION"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚠️  WARNING: This will permanently delete:"
echo "   - ECS cluster: $OLD_CLUSTER"
echo "   - All services in the cluster"
echo "   - All running tasks"
echo ""
echo "This is the OLD cluster from Amplify setup."
echo "Your new clusters (furnace-cluster-dev, furnace-cluster-prod) will NOT be affected."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "Are you sure you want to delete the old cluster? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Cancelled."
  exit 0
fi

echo ""
echo "1️⃣  Stopping and deleting services..."

# Get all services in the old cluster
SERVICES=$(aws ecs list-services \
  --cluster "$OLD_CLUSTER" \
  --region "$REGION" \
  --query 'serviceArns' \
  --output text 2>/dev/null || echo "")

if [ -n "$SERVICES" ] && [ "$SERVICES" != "None" ]; then
  for SERVICE_ARN in $SERVICES; do
    SERVICE_NAME=$(echo "$SERVICE_ARN" | awk -F'/' '{print $NF}')
    echo "   Stopping service: $SERVICE_NAME"
    
    # Update service to 0 tasks
    aws ecs update-service \
      --cluster "$OLD_CLUSTER" \
      --service "$SERVICE_NAME" \
      --desired-count 0 \
      --region "$REGION" \
      --output json > /dev/null
    
    echo "   ✅ Service scaled to 0, waiting for tasks to stop..."
    
    # Wait for service to reach 0 running tasks
    aws ecs wait services-stable \
      --cluster "$OLD_CLUSTER" \
      --services "$SERVICE_NAME" \
      --region "$REGION" || true
    
    # Delete the service
    echo "   Deleting service: $SERVICE_NAME"
    aws ecs delete-service \
      --cluster "$OLD_CLUSTER" \
      --service "$SERVICE_NAME" \
      --region "$REGION" \
      --output json > /dev/null
    
    echo "   ✅ Service deleted"
    echo ""
  done
else
  echo "   ✅ No services found (or already deleted)"
fi

echo "2️⃣  Waiting for all services to be deleted..."
sleep 5

echo ""
echo "3️⃣  Deleting cluster: $OLD_CLUSTER"
aws ecs delete-cluster \
  --cluster "$OLD_CLUSTER" \
  --region "$REGION" \
  --output json > /dev/null

echo "✅ Cluster deletion initiated"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Old cluster deletion complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Note: Cluster deletion may take a few minutes to complete"
echo "   You can verify with:"
echo "   aws ecs describe-clusters --clusters $OLD_CLUSTER --region $REGION"
echo ""
