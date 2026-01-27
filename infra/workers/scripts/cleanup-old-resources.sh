#!/bin/bash
# Clean up old ECS infrastructure from Amplify-based setup

set -e

REGION="${CDK_DEFAULT_REGION:-us-west-2}"

echo "🧹 Cleaning Up Old ECS Resources"
echo "   Region: $REGION"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚠️  WARNING: This will list resources that may need cleanup"
echo "   Review carefully before deleting anything!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Check for old ECS clusters (non-dev/prod)
echo "1️⃣  Checking for old ECS clusters..."
ALL_CLUSTERS=$(aws ecs list-clusters --region "$REGION" --query 'clusterArns' --output text)

if [ -n "$ALL_CLUSTERS" ] && [ "$ALL_CLUSTERS" != "None" ]; then
  echo "   Found clusters:"
  for CLUSTER_ARN in $ALL_CLUSTERS; do
    CLUSTER_NAME=$(echo "$CLUSTER_ARN" | awk -F'/' '{print $NF}')
    echo "   - $CLUSTER_NAME"
    
    # Check if it's one of our new clusters
    if [[ "$CLUSTER_NAME" == "furnace-cluster-dev" ]] || [[ "$CLUSTER_NAME" == "furnace-cluster-prod" ]]; then
      echo "     ✅ Keeping (new infrastructure)"
    else
      echo "     ⚠️  Possible old cluster - review for deletion"
      
      # Check if cluster has services
      SERVICES=$(aws ecs list-services \
        --cluster "$CLUSTER_NAME" \
        --region "$REGION" \
        --query 'serviceArns' \
        --output text 2>/dev/null || echo "")
      
      if [ -n "$SERVICES" ] && [ "$SERVICES" != "None" ]; then
        echo "     📋 Has services - check before deleting"
        echo "$SERVICES" | tr '\t' '\n' | sed 's/^/       - /'
      else
        echo "     ✅ No services - safe to delete"
      fi
    fi
    echo ""
  done
else
  echo "   ✅ No clusters found"
fi

# 2. Check for old ECR repositories (without environment suffix)
echo "2️⃣  Checking for old ECR repositories..."
ALL_REPOS=$(aws ecr describe-repositories \
  --region "$REGION" \
  --query 'repositories[?starts_with(repositoryName, `furnace/`)].repositoryName' \
  --output text 2>/dev/null || echo "")

if [ -n "$ALL_REPOS" ] && [ "$ALL_REPOS" != "None" ]; then
  echo "   Found Furnace repositories:"
  for REPO_NAME in $ALL_REPOS; do
    echo "   - $REPO_NAME"
    
    # Check if it's one of our new repos
    if [[ "$REPO_NAME" == "furnace/send-worker-dev" ]] || \
       [[ "$REPO_NAME" == "furnace/send-worker-prod" ]] || \
       [[ "$REPO_NAME" == "furnace/scheduler-worker-dev" ]] || \
       [[ "$REPO_NAME" == "furnace/scheduler-worker-prod" ]] || \
       [[ "$REPO_NAME" == "furnace/inbox-checker-worker-dev" ]] || \
       [[ "$REPO_NAME" == "furnace/inbox-checker-worker-prod" ]]; then
      echo "     ✅ Keeping (new infrastructure)"
    else
      echo "     ⚠️  Possible old repository - review for deletion"
      
      # Check if repo has images
      IMAGE_COUNT=$(aws ecr describe-images \
        --repository-name "$REPO_NAME" \
        --region "$REGION" \
        --query 'length(imageDetails)' \
        --output text 2>/dev/null || echo "0")
      
      if [ "$IMAGE_COUNT" -gt 0 ]; then
        echo "     📋 Has $IMAGE_COUNT image(s) - check before deleting"
      else
        echo "     ✅ Empty - safe to delete"
      fi
    fi
    echo ""
  done
else
  echo "   ✅ No Furnace repositories found"
fi

# 3. Check for old CloudWatch log groups
echo "3️⃣  Checking for old CloudWatch log groups..."
OLD_LOG_GROUPS=$(aws logs describe-log-groups \
  --log-group-name-prefix "/ecs/furnace/" \
  --region "$REGION" \
  --query 'logGroups[?!contains(logGroupName, `-dev`) && !contains(logGroupName, `-prod`)].logGroupName' \
  --output text 2>/dev/null || echo "")

if [ -n "$OLD_LOG_GROUPS" ] && [ "$OLD_LOG_GROUPS" != "None" ]; then
  echo "   Found old log groups (without -dev/-prod suffix):"
  for LOG_GROUP in $OLD_LOG_GROUPS; do
    echo "   - $LOG_GROUP"
    echo "     ⚠️  Possible old log group - review for deletion"
  done
else
  echo "   ✅ No old log groups found"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 Cleanup Instructions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To delete old resources, use:"
echo ""
echo "1. Delete old ECS cluster:"
echo "   aws ecs delete-cluster --cluster <cluster-name> --region $REGION"
echo ""
echo "2. Delete old ECR repository:"
echo "   aws ecr delete-repository --repository-name <repo-name> --region $REGION --force"
echo ""
echo "3. Delete old CloudWatch log group:"
echo "   aws logs delete-log-group --log-group-name <log-group-name> --region $REGION"
echo ""
echo "⚠️  IMPORTANT:"
echo "   - Make sure no services are using the cluster before deleting"
echo "   - Make sure the old repos aren't referenced anywhere"
echo "   - CloudWatch logs deletion is permanent"
echo ""
