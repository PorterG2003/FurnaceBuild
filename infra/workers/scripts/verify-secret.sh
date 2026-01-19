#!/bin/bash
# Verify Supabase Secret Key stored in Parameter Store

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

REGION="${CDK_DEFAULT_REGION:-us-west-2}"

# Validate environment
if [ "$ENVIRONMENT" != "dev" ] && [ "$ENVIRONMENT" != "prod" ]; then
  echo "❌ Error: Environment must be 'dev' or 'prod'"
  echo "Usage: $0 [dev|prod]"
  exit 1
fi

# Set parameter path based on environment
if [ "$ENVIRONMENT" = "dev" ]; then
  PARAM_PATH="/amplify/furnacebuild/dev/SUPABASE_SERVICE_KEY"
  SUPABASE_URL="${DEV_SUPABASE_URL}"
else
  PARAM_PATH="/amplify/shared/d1jtp0rz0l9mcn/SUPABASE_SERVICE_KEY"
  SUPABASE_URL="${PROD_SUPABASE_URL}"
fi

if [ -z "$SUPABASE_URL" ]; then
  echo "❌ Error: SUPABASE_URL not found in .env.local"
  echo "   For dev: DEV_SUPABASE_URL"
  echo "   For prod: PROD_SUPABASE_URL"
  exit 1
fi

echo "🔍 Verifying Supabase Secret Key"
echo "   Environment: $ENVIRONMENT"
echo "   Parameter: $PARAM_PATH"
echo "   Region: $REGION"
echo ""

# Get the secret from Parameter Store
echo "📥 Fetching secret from Parameter Store..."
SECRET_VALUE=$(aws ssm get-parameter \
  --name "$PARAM_PATH" \
  --region "$REGION" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text 2>/dev/null)

if [ -z "$SECRET_VALUE" ] || [ "$SECRET_VALUE" = "None" ]; then
  echo "❌ Error: Parameter not found or has no value"
  echo "   Run: npm run set-secret:$ENVIRONMENT"
  exit 1
fi

# Trim the secret (remove any whitespace)
TRIMMED_SECRET=$(echo "$SECRET_VALUE" | tr -d '\n\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

# Show some info about the secret (without exposing it)
SECRET_LENGTH=${#TRIMMED_SECRET}
FIRST_CHARS="${TRIMMED_SECRET:0:8}..."
LAST_CHARS="...${TRIMMED_SECRET: -8}"

echo "✅ Secret retrieved from Parameter Store"
echo "   Length: $SECRET_LENGTH characters"
echo "   Preview: $FIRST_CHARS$LAST_CHARS"
echo ""

# Check if it looks like a valid Supabase Secret Key
if [[ "$TRIMMED_SECRET" =~ ^sb_ ]]; then
  echo "✅ Format looks valid (Supabase Secret Key - new format, starts with 'sb_')"
elif [[ "$TRIMMED_SECRET" =~ ^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]]; then
  echo "✅ Format looks valid (Supabase Secret Key - legacy JWT format, starts with 'eyJ')"
else
  echo "⚠️  Warning: Format doesn't match expected patterns"
  echo "   Expected: Starts with 'sb_' (new format) or 'eyJ' (legacy JWT format)"
  echo "   Make sure you copied the 'Secret Key' not the 'Publishable Key'"
fi

# Check for whitespace issues
ORIGINAL_LENGTH=${#SECRET_VALUE}
if [ "$ORIGINAL_LENGTH" -ne "$SECRET_LENGTH" ]; then
  echo "⚠️  Warning: Secret contains whitespace/newlines"
  echo "   Original length: $ORIGINAL_LENGTH"
  echo "   Trimmed length: $SECRET_LENGTH"
  echo "   The worker code will trim it, but you should re-set it cleanly"
fi

echo ""
echo "🧪 Testing Secret Key with Supabase..."

# Test the key by making a simple API call to Supabase
# For new format (sb_...), use Authorization header with Bearer
# For legacy JWT format, both apikey and Authorization headers work
if [[ "$TRIMMED_SECRET" =~ ^sb_ ]]; then
  # New format: use Authorization header
  TEST_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $TRIMMED_SECRET" \
    "${SUPABASE_URL}/rest/v1/" 2>/dev/null || echo "000")
else
  # Legacy format: use both apikey and Authorization headers
  TEST_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "apikey: $TRIMMED_SECRET" \
    -H "Authorization: Bearer $TRIMMED_SECRET" \
    "${SUPABASE_URL}/rest/v1/" 2>/dev/null || echo "000")
fi

HTTP_CODE=$(echo "$TEST_RESPONSE" | tail -n 1)
RESPONSE_BODY=$(echo "$TEST_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "404" ]; then
  # 200 or 404 both mean auth worked (404 just means endpoint doesn't exist, but auth passed)
  echo "✅ Secret Key is VALID! Supabase accepted the key"
  echo ""
  echo "📝 Next steps:"
  echo "   If workers still show 'Invalid API key' errors:"
  echo "   1. Rebuild Docker images: npm run build:$ENVIRONMENT"
  echo "   2. Restart services: npm run restart:$ENVIRONMENT"
elif [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  echo "❌ Secret Key is INVALID! Supabase rejected the key"
  echo ""
  echo "🔧 Fix:"
  echo "   1. Go to Supabase Dashboard → $ENVIRONMENT branch → Settings → API"
  echo "   2. Click 'API Keys' tab (not 'Legacy API Keys')"
  echo "   3. Copy the 'Secret Key' (NOT 'Publishable Key')"
  echo "   4. Re-set it: npm run set-secret:$ENVIRONMENT"
elif [ "$HTTP_CODE" = "000" ]; then
  echo "⚠️  Could not test (network error or invalid URL)"
  echo "   SUPABASE_URL: $SUPABASE_URL"
  echo "   Verify the URL is correct in .env.local"
else
  echo "⚠️  Unexpected response (HTTP $HTTP_CODE)"
  echo "   This might still be valid - check if workers can connect"
fi

echo ""

