#!/bin/bash
# Set Supabase Service Role Key in SSM Parameter Store

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
SERVICE_KEY="${2}"

REGION="${CDK_DEFAULT_REGION:-us-west-2}"

# Validate environment
if [ "$ENVIRONMENT" != "dev" ] && [ "$ENVIRONMENT" != "prod" ]; then
  echo "❌ Error: Environment must be 'dev' or 'prod'"
  echo "Usage: $0 [dev|prod] [service-key]"
  echo ""
  echo "If service-key is not provided, you will be prompted to enter it."
  exit 1
fi

# Set parameter path based on environment
if [ "$ENVIRONMENT" = "dev" ]; then
  PARAM_PATH="/amplify/furnacebuild/dev/SUPABASE_SERVICE_KEY"
else
  PARAM_PATH="/amplify/shared/d1jtp0rz0l9mcn/SUPABASE_SERVICE_KEY"
fi

# Get service key if not provided
if [ -z "$SERVICE_KEY" ]; then
  echo "📝 Please enter the Supabase Secret Key for $ENVIRONMENT:"
  echo ""
  echo "   Where to find it:"
  echo "   1. Go to Supabase Dashboard → Switch to '$ENVIRONMENT' branch"
  echo "   2. Go to Settings → API"
  echo "   3. Click the 'API Keys' tab (not 'Legacy API Keys')"
  echo "   4. Copy the 'Secret Key' (NOT the 'Publishable Key')"
  echo ""
  echo "   ⚠️  Important: Use the 'Secret Key' - it bypasses RLS (needed for workers)"
  echo "   ⚠️  Do NOT use the 'Publishable Key' - that's for client-side use only"
  echo ""
  read -s SERVICE_KEY
  echo ""
  
  if [ -z "$SERVICE_KEY" ]; then
    echo "❌ Error: Secret key cannot be empty"
    exit 1
  fi
fi

# Trim whitespace and newlines (common when pasting)
SERVICE_KEY=$(echo "$SERVICE_KEY" | tr -d '\n\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

echo "🔐 Setting SSM parameter..."
echo "   Parameter: $PARAM_PATH"
echo "   Environment: $ENVIRONMENT"
echo "   Region: $REGION"
echo ""

# Show preview before storing (without exposing full key)
SECRET_LENGTH=${#SERVICE_KEY}
FIRST_CHARS="${SERVICE_KEY:0:8}..."
LAST_CHARS="...${SERVICE_KEY: -8}"

echo "📋 Secret preview (for verification):"
echo "   Length: $SECRET_LENGTH characters"
echo "   Preview: $FIRST_CHARS$LAST_CHARS"
echo ""

# Check if it looks like a Supabase Secret Key (new format: sb_... or legacy JWT: eyJ...)
if [[ "$SERVICE_KEY" =~ ^sb_ ]]; then
  echo "✅ Format looks valid (Supabase Secret Key - new format)"
elif [[ "$SERVICE_KEY" =~ ^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]]; then
  echo "✅ Format looks valid (Supabase Secret Key - legacy JWT format)"
else
  echo "⚠️  Warning: Format doesn't match expected patterns"
  echo "   Expected: Starts with 'sb_' (new format) or 'eyJ' (legacy JWT format)"
  echo "   Make sure you copied the 'Secret Key' not 'Publishable Key'"
  echo ""
  read -p "   Continue anyway? (y/n) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled"
    exit 1
  fi
fi

echo ""

# Create or update the parameter
aws ssm put-parameter \
  --name "$PARAM_PATH" \
  --value "$SERVICE_KEY" \
  --type "SecureString" \
  --region "$REGION" \
  --overwrite \
  --description "Supabase Secret Key for $ENVIRONMENT environment (used by ECS workers - bypasses RLS)" \
  > /dev/null

if [ $? -eq 0 ]; then
  echo "✅ Successfully set parameter: $PARAM_PATH"
  echo ""
  echo "🧪 Verify the secret key:"
  echo "   npm run verify-secret:$ENVIRONMENT"
  echo ""
  echo "📝 Next steps:"
  echo "   1. Verify the secret: npm run verify-secret:$ENVIRONMENT"
  echo "   2. Rebuild Docker images (if code changed): npm run build:$ENVIRONMENT"
  echo "   3. Restart services: npm run restart:$ENVIRONMENT"
  echo ""
  echo "   4. Check CloudWatch logs:"
  echo "      aws logs tail /ecs/furnace/send-worker-$ENVIRONMENT --follow --region $REGION"
  echo "      aws logs tail /ecs/furnace/scheduler-worker-$ENVIRONMENT --follow --region $REGION"
  echo "      aws logs tail /ecs/furnace/inbox-checker-worker-$ENVIRONMENT --follow --region $REGION"
else
  echo "❌ Failed to set parameter"
  exit 1
fi

