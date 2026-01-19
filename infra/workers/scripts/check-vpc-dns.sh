#!/bin/bash
# Check VPC DNS settings

set -e

ENVIRONMENT="${1:-dev}"
REGION="${CDK_DEFAULT_REGION:-us-west-2}"
STACK_NAME="WorkerStack-$(echo "${ENVIRONMENT:0:1}" | tr '[:lower:]' '[:upper:]')${ENVIRONMENT:1}"

echo "🔍 Checking VPC DNS Configuration"
echo "   Stack: $STACK_NAME"
echo "   Region: $REGION"
echo ""

# Get VPC ID from CloudFormation
VPC_ID=$(aws cloudformation describe-stack-resources \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "StackResources[?ResourceType=='AWS::EC2::VPC'].PhysicalResourceId" \
  --output text 2>/dev/null | head -1 || echo "")

if [ -z "$VPC_ID" ] || [ "$VPC_ID" = "None" ]; then
  echo "❌ Could not find VPC in stack"
  exit 1
fi

echo "✅ Found VPC: $VPC_ID"
echo ""

# Check DNS settings
echo "Current DNS Settings:"
DNS_SUPPORT=$(aws ec2 describe-vpc-attribute \
  --vpc-id "$VPC_ID" \
  --attribute enableDnsSupport \
  --region "$REGION" \
  --query 'EnableDnsSupport.Value' \
  --output text)

DNS_HOSTNAMES=$(aws ec2 describe-vpc-attribute \
  --vpc-id "$VPC_ID" \
  --attribute enableDnsHostnames \
  --region "$REGION" \
  --query 'EnableDnsHostnames.Value' \
  --output text)

echo "   DNS Support: $DNS_SUPPORT"
echo "   DNS Hostnames: $DNS_HOSTNAMES"
echo ""

if [ "$DNS_SUPPORT" != "True" ] || [ "$DNS_HOSTNAMES" != "True" ]; then
  echo "❌ DNS is NOT fully enabled!"
  echo ""
  echo "🔧 To fix, run:"
  echo ""
  if [ "$DNS_SUPPORT" != "true" ]; then
    echo "   aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support --region $REGION"
  fi
  if [ "$DNS_HOSTNAMES" != "true" ]; then
    echo "   aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames --region $REGION"
  fi
  echo ""
  echo "Or use: npm run fix:vpc-dns $ENVIRONMENT"
else
  echo "✅ DNS is properly configured"
  echo ""
  echo "⚠️  If DNS still fails, the issue might be:"
  echo "   1. Security group blocking DNS (port 53 UDP/TCP)"
  echo "   2. Route table issues"
  echo "   3. Internet Gateway not attached"
fi
