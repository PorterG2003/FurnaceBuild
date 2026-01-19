#!/bin/bash
# Check CloudFormation stack status

STACK_NAME="WorkerStack-Dev"
REGION="${CDK_DEFAULT_REGION:-us-west-2}"
ACCOUNT="${CDK_DEFAULT_ACCOUNT:-686255981838}"

echo "Checking stack status for $STACK_NAME..."
echo ""

aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].[StackName,StackStatus,CreationTime]' \
  --output table 2>&1

echo ""
echo "Recent stack events:"
aws cloudformation describe-stack-events \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --max-items 10 \
  --query 'StackEvents[*].[Timestamp,ResourceStatus,ResourceType,LogicalResourceId,ResourceStatusReason]' \
  --output table 2>&1


