#!/bin/bash
# Verify Supabase Secret Key stored in Parameter Store (path from env or --param).

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
INFRA_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../../.." && pwd )"

for f in "$REPO_ROOT/.env.local" "$REPO_ROOT/.env" "$INFRA_DIR/.env.local"; do
  if [ -f "$f" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$f"
    set +a
  fi
done

PARAM_PATH=""
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --param)
      if [ -z "${2:-}" ]; then
        echo "❌ Error: --param requires a value"
        exit 1
      fi
      PARAM_PATH="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [dev|prod]"
      echo "       $0 --param /full/ssm/parameter/name"
      echo ""
      echo "  dev|prod   Use DEV_SECRET_SSM_PREFIX or PROD_SECRET_SSM_PREFIX + /SUPABASE_SECRET_KEY from env."
      echo ""
      echo "See docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md"
      exit 0
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

ENVIRONMENT="${ARGS[0]:-dev}"

REGION="${CDK_DEFAULT_REGION:-us-west-2}"

if [ "$ENVIRONMENT" != "dev" ] && [ "$ENVIRONMENT" != "prod" ]; then
  echo "❌ Error: Environment must be 'dev' or 'prod'"
  echo "Usage: $0 [dev|prod]"
  echo "       $0 --param /full/ssm/name"
  exit 1
fi

if [ -z "$PARAM_PATH" ]; then
  if [ "$ENVIRONMENT" = "dev" ]; then
    PFX="${DEV_SECRET_SSM_PREFIX:-}"
    SUPABASE_URL="${DEV_SUPABASE_URL:-$EXPO_PUBLIC_SUPABASE_URL}"
  else
    PFX="${PROD_SECRET_SSM_PREFIX:-}"
    SUPABASE_URL="${PROD_SUPABASE_URL}"
  fi
  if [ -n "$PFX" ]; then
    PFX="${PFX%/}"
    PARAM_PATH="${PFX}/SUPABASE_SECRET_KEY"
  fi
fi

if [ -z "$PARAM_PATH" ]; then
  echo "❌ Error: No SSM parameter path set."
  echo "   Set DEV_SECRET_SSM_PREFIX or PROD_SECRET_SSM_PREFIX in .env.local (or pass --param)."
  echo "   See docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md"
  exit 1
fi

if [[ "$PARAM_PATH" != /* ]]; then
  PARAM_PATH="/$PARAM_PATH"
fi

if [ -z "$SUPABASE_URL" ]; then
  echo "❌ Error: Supabase URL not found for this environment"
  echo "   For dev: set DEV_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL"
  echo "   For prod: set PROD_SUPABASE_URL"
  exit 1
fi

echo "🔍 Verifying Supabase Secret Key"
echo "   Environment: $ENVIRONMENT"
echo "   Parameter: $PARAM_PATH"
echo "   Region: $REGION"
echo ""

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

TRIMMED_SECRET=$(echo "$SECRET_VALUE" | tr -d '\n\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

SECRET_LENGTH=${#TRIMMED_SECRET}
FIRST_CHARS="${TRIMMED_SECRET:0:8}..."
LAST_CHARS="...${TRIMMED_SECRET: -8}"

echo "✅ Secret retrieved from Parameter Store"
echo "   Length: $SECRET_LENGTH characters"
echo "   Preview: $FIRST_CHARS$LAST_CHARS"
echo ""

if [[ "$TRIMMED_SECRET" =~ ^sb_ ]]; then
  echo "✅ Format looks valid (Supabase Secret Key - new format, starts with 'sb_')"
elif [[ "$TRIMMED_SECRET" =~ ^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]]; then
  echo "✅ Format looks valid (Supabase Secret Key - legacy JWT format, starts with 'eyJ')"
else
  echo "⚠️  Warning: Format doesn't match expected patterns"
  echo "   Expected: Starts with 'sb_' (new format) or 'eyJ' (legacy JWT format)"
  echo "   Make sure you copied the 'Secret Key' not the 'Publishable Key'"
fi

ORIGINAL_LENGTH=${#SECRET_VALUE}
if [ "$ORIGINAL_LENGTH" -ne "$SECRET_LENGTH" ]; then
  echo "⚠️  Warning: Secret contains whitespace/newlines"
  echo "   Original length: $ORIGINAL_LENGTH"
  echo "   Trimmed length: $SECRET_LENGTH"
  echo "   The worker code will trim it, but you should re-set it cleanly"
fi

echo ""
echo "🧪 Testing Secret Key with Supabase..."

# New sb_publishable_ / sb_secret_ keys: gateway requires apikey; Bearer must match apikey (not JWT).
# See https://supabase.com/docs/guides/api/api-keys
if [[ "$TRIMMED_SECRET" =~ ^sb_ ]]; then
  TEST_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "apikey: $TRIMMED_SECRET" \
    -H "Authorization: Bearer $TRIMMED_SECRET" \
    "${SUPABASE_URL}/rest/v1/" 2>/dev/null || echo "000")
else
  TEST_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "apikey: $TRIMMED_SECRET" \
    -H "Authorization: Bearer $TRIMMED_SECRET" \
    "${SUPABASE_URL}/rest/v1/" 2>/dev/null || echo "000")
fi

HTTP_CODE=$(echo "$TEST_RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "404" ]; then
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
