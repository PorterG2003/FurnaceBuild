#!/bin/bash
# Cancel a stuck CloudFormation stack deployment

STACK_NAME="${1:-WorkerStack-Dev}"
REGION="${CDK_DEFAULT_REGION:-us-west-2}"

echo "⚠️  WARNING: This will cancel the stack deployment: $STACK_NAME"
echo "   This may leave some resources in an intermediate state."
echo ""
read -p "Are you sure you want to cancel? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Cancelled."
  exit 0
fi

echo "Cancelling stack deployment..."
aws cloudformation cancel-update-stack \
  --stack-name "$STACK_NAME" \
  --region "$REGION" 2>&1

# Note: For CREATE_IN_PROGRESS, we need to delete the stack instead
if [ $? -ne 0 ]; then
  echo ""
  echo "Stack is in CREATE_IN_PROGRESS (not UPDATE_IN_PROGRESS)."
  echo "To cancel, you need to delete the stack instead:"
  echo ""
  echo "  aws cloudformation delete-stack --stack-name $STACK_NAME --region $REGION"
  echo ""
  echo "⚠️  This will DELETE all resources in the stack!"
  echo ""
  read -p "Delete the stack? (yes/no): " delete_confirm
  
  if [ "$delete_confirm" == "yes" ]; then
    aws cloudformation delete-stack \
      --stack-name "$STACK_NAME" \
      --region "$REGION"
    echo "Stack deletion initiated. Check status with:"
    echo "  aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION"
  else
    echo "Cancelled."
  fi
fi


