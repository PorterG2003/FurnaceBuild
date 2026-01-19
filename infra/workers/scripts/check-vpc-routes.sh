#!/bin/bash
# Check VPC route tables and Internet Gateway configuration

set -e

ENVIRONMENT="${1:-dev}"
REGION="${CDK_DEFAULT_REGION:-us-west-2}"
STACK_NAME="WorkerStack-$(echo "${ENVIRONMENT:0:1}" | tr '[:lower:]' '[:upper:]')${ENVIRONMENT:1}"

echo "🔍 Checking VPC Route Configuration"
echo "   Stack: $STACK_NAME"
echo "   Region: $REGION"
echo ""

# Get VPC ID
VPC_ID=$(aws cloudformation describe-stack-resources \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "StackResources[?ResourceType=='AWS::EC2::VPC'].PhysicalResourceId" \
  --output text 2>/dev/null | head -1 || echo "")

if [ -z "$VPC_ID" ] || [ "$VPC_ID" = "None" ]; then
  echo "❌ Could not find VPC"
  exit 1
fi

echo "✅ VPC: $VPC_ID"
echo ""

# Get Internet Gateway
echo "1️⃣  Checking Internet Gateway..."
IGW_ID=$(aws ec2 describe-internet-gateways \
  --filters "Name=attachment.vpc-id,Values=$VPC_ID" \
  --region "$REGION" \
  --query 'InternetGateways[0].InternetGatewayId' \
  --output text 2>/dev/null || echo "")

if [ -z "$IGW_ID" ] || [ "$IGW_ID" = "None" ]; then
  echo "   ❌ No Internet Gateway attached to VPC!"
  echo "   💡 Public subnets need an Internet Gateway for outbound internet access"
else
  echo "   ✅ Internet Gateway attached: $IGW_ID"
fi
echo ""

# Get public subnets
echo "2️⃣  Checking Public Subnets..."
PUBLIC_SUBNETS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --region "$REGION" \
  --query 'Subnets[?MapPublicIpOnLaunch==`true`].SubnetId' \
  --output text)

if [ -z "$PUBLIC_SUBNETS" ] || [ "$PUBLIC_SUBNETS" = "None" ]; then
  echo "   ❌ No public subnets found"
else
  echo "   ✅ Public subnets found:"
  for SUBNET in $PUBLIC_SUBNETS; do
    echo "      - $SUBNET"
  done
fi
echo ""

# Check route tables for public subnets
echo "3️⃣  Checking Route Tables..."
for SUBNET in $PUBLIC_SUBNETS; do
  echo "   Subnet: $SUBNET"
  
  ROUTE_TABLE=$(aws ec2 describe-route-tables \
    --filters "Name=association.subnet-id,Values=$SUBNET" \
    --region "$REGION" \
    --query 'RouteTables[0].RouteTableId' \
    --output text 2>/dev/null || echo "")
  
  if [ -n "$ROUTE_TABLE" ] && [ "$ROUTE_TABLE" != "None" ]; then
    echo "      Route Table: $ROUTE_TABLE"
    
    # Check for 0.0.0.0/0 route to IGW
    DEFAULT_ROUTE=$(aws ec2 describe-route-tables \
      --route-table-ids "$ROUTE_TABLE" \
      --region "$REGION" \
      --query 'RouteTables[0].Routes[?DestinationCidrBlock==`0.0.0.0/0`]' \
      --output json)
    
    HAS_IGW_ROUTE=$(echo "$DEFAULT_ROUTE" | jq -r '.[] | select(.GatewayId == "'$IGW_ID'") | .GatewayId' 2>/dev/null || echo "")
    
    if [ -n "$HAS_IGW_ROUTE" ]; then
      echo "      ✅ Has route to Internet Gateway (0.0.0.0/0 → $IGW_ID)"
    else
      echo "      ❌ Missing route to Internet Gateway!"
      echo "         Public subnets need 0.0.0.0/0 → Internet Gateway for internet access"
    fi
  else
    echo "      ⚠️  No route table found for subnet"
  fi
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
