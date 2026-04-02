#!/bin/bash
# Set Supabase Secret Key in SSM Parameter Store at the path you configure (Amplify or manual).

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
        echo "❌ Error: --param requires a value (full SSM parameter name, e.g. /amplify/.../SUPABASE_SECRET_KEY)"
        exit 1
      fi
      PARAM_PATH="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [dev|prod] [service-key]"
      echo "       $0 --param /full/ssm/parameter/name [service-key]"
      echo ""
      echo "  dev|prod       Uses DEV_SECRET_SSM_PREFIX or PROD_SECRET_SSM_PREFIX + /SUPABASE_SECRET_KEY when --param is omitted."
      echo "  service-key    Optional; if omitted you are prompted (hidden input)."
      echo ""
      echo "Requires DEV_SECRET_SSM_PREFIX / PROD_SECRET_SSM_PREFIX in .env.local unless --param is set."
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
SERVICE_KEY="${ARGS[1]:-}"

REGION="${CDK_DEFAULT_REGION:-us-west-2}"

if [ "$ENVIRONMENT" != "dev" ] && [ "$ENVIRONMENT" != "prod" ]; then
  echo "❌ Error: Environment must be 'dev' or 'prod' (first positional argument)"
  echo "Usage: $0 [dev|prod] [service-key]"
  echo "       $0 --param /full/ssm/name [service-key]"
  exit 1
fi

if [ -z "$PARAM_PATH" ]; then
  if [ "$ENVIRONMENT" = "dev" ]; then
    PFX="${DEV_SECRET_SSM_PREFIX:-}"
  else
    PFX="${PROD_SECRET_SSM_PREFIX:-}"
  fi
  if [ -n "$PFX" ]; then
    PFX="${PFX%/}"
    PARAM_PATH="${PFX}/SUPABASE_SECRET_KEY"
  fi
fi

if [ -z "$PARAM_PATH" ]; then
  echo "❌ Error: No SSM parameter path set."
  echo "   Set DEV_SECRET_SSM_PREFIX or PROD_SECRET_SSM_PREFIX in infra/workers/.env.local (or pass --param /full/name)."
  echo "   See docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md"
  exit 1
fi

# Normalize: ensure leading slash for display/AWS
if [[ "$PARAM_PATH" != /* ]]; then
  PARAM_PATH="/$PARAM_PATH"
fi

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
  read -r -s SERVICE_KEY
  echo ""

  if [ -z "$SERVICE_KEY" ]; then
    echo "❌ Error: Secret key cannot be empty"
    exit 1
  fi
fi

SERVICE_KEY=$(echo "$SERVICE_KEY" | tr -d '\n\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

echo "🔐 Setting SSM parameter..."
echo "   Parameter: $PARAM_PATH"
echo "   Environment: $ENVIRONMENT"
echo "   Region: $REGION"
echo ""

SECRET_LENGTH=${#SERVICE_KEY}
FIRST_CHARS="${SERVICE_KEY:0:8}..."
LAST_CHARS="...${SERVICE_KEY: -8}"

echo "📋 Secret preview (for verification):"
echo "   Length: $SECRET_LENGTH characters"
echo "   Preview: $FIRST_CHARS$LAST_CHARS"
echo ""

if [[ "$SERVICE_KEY" =~ ^sb_ ]]; then
  echo "✅ Format looks valid (Supabase Secret Key - new format)"
elif [[ "$SERVICE_KEY" =~ ^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]]; then
  echo "✅ Format looks valid (Supabase Secret Key - legacy JWT format)"
else
  echo "⚠️  Warning: Format doesn't match expected patterns"
  echo "   Expected: Starts with 'sb_' (new format) or 'eyJ' (legacy JWT format)"
  echo "   Make sure you copied the 'Secret Key' not 'Publishable Key'"
  echo ""
  read -r -p "   Continue anyway? (y/n) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled"
    exit 1
  fi
fi

echo ""

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
