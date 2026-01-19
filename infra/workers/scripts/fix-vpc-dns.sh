#!/bin/bash
# Fix VPC DNS settings for dev cluster

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

ENVIRONMENT="${1:-dev}"
REGION="${CDK_DEFAULT_REGION:-us-west-2}"

echo "🔧 Fixing VPC DNS Settings"
echo "   Environment: $ENVIRONMENT"
echo "   Region: $REGION"
echo ""

# Get the VPC ID from a service's subnet
CLUSTER_NAME="furnace-cluster-$ENVIRONMENT"

echo "1️⃣  Finding VPC for cluster: $CLUSTER_NAME..."

# Get VPC from service subnet
SERVICE_NAME=$(aws ecs list-services \
  --cluster "$CLUSTER_NAME" \
  --region "$REGION" \
  --query "serviceArns[?contains(@, 'SchedulerWorker')]" \
  --output text 2>/dev/null | head -1 | awk -F'/' '{print $NF}')

if [ -n "$SERVICE_NAME" ] && [ "$SERVICE_NAME" != "None" ]; then
  SERVICE_INFO=$(aws ecs describe-services \
    --cluster "$CLUSTER_NAME" \
    --services "$SERVICE_NAME" \
    --region "$REGION" \
    --query 'services[0].networkConfiguration.awsvpcConfiguration.subnets[0]' \
    --output text 2>/dev/null || echo "")
  
  if [ -n "$SERVICE_INFO" ] && [ "$SERVICE_INFO" != "None" ]; then
    VPC_ID=$(aws ec2 describe-subnets \
      --subnet-ids "$SERVICE_INFO" \
      --region "$REGION" \
      --query 'Subnets[0].VpcId' \
      --output text 2>/dev/null || echo "")
  fi
fi

# If still not found, try to find VPC by CloudFormation stack
if [ -z "$VPC_ID" ] || [ "$VPC_ID" = "None" ]; then
  echo "   Searching for VPC from CloudFormation stack..."
  STACK_NAME="WorkerStack-$(echo "${ENVIRONMENT:0:1}" | tr '[:lower:]' '[:upper:]')${ENVIRONMENT:1}"
  VPC_ID=$(aws cloudformation describe-stack-resources \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "StackResources[?ResourceType=='AWS::EC2::VPC'].PhysicalResourceId" \
    --output text 2>/dev/null | head -1 || echo "")
fi

if [ -z "$VPC_ID" ] || [ "$VPC_ID" = "None" ]; then
  echo "   ❌ Could not find VPC automatically"
  echo ""
  echo "   💡 Find VPC manually:"
  echo "      1. Go to AWS Console → VPC → Your VPCs"
  echo "      2. Look for VPC used by cluster: $CLUSTER_NAME"
  echo "      3. Note the VPC ID"
  echo ""
  echo "   Then enable DNS manually:"
  echo "      aws ec2 modify-vpc-attribute --vpc-id <vpc-id> --enable-dns-support"
  echo "      aws ec2 modify-vpc-attribute --vpc-id <vpc-id> --enable-dns-hostnames"
  exit 1
fi

echo "   ✅ Found VPC: $VPC_ID"
echo ""

# Check current DNS settings
echo "2️⃣  Checking current DNS settings..."
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

# Enable DNS if not already enabled
if [ "$DNS_SUPPORT" != "true" ]; then
  echo "3️⃣  Enabling DNS support..."
  aws ec2 modify-vpc-attribute \
    --vpc-id "$VPC_ID" \
    --enable-dns-support \
    --region "$REGION"
  echo "   ✅ DNS support enabled"
else
  echo "   ✅ DNS support already enabled"
fi

if [ "$DNS_HOSTNAMES" != "true" ]; then
  echo ""
  echo "4️⃣  Enabling DNS hostnames..."
  aws ec2 modify-vpc-attribute \
    --vpc-id "$VPC_ID" \
    --enable-dns-hostnames \
    --region "$REGION"
  echo "   ✅ DNS hostnames enabled"
else
  echo "   ✅ DNS hostnames already enabled"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ VPC DNS settings updated!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Restart the services to pick up the changes:"
echo "   npm run restart:$ENVIRONMENT"
echo ""
