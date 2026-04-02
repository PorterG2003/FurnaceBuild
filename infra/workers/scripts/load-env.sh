#!/bin/bash
# Load environment variables from repo-root and/or infra/workers .env.local, then run the command.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../../.." && pwd )"

ROOT_ENV="$REPO_ROOT/.env.local"
WORKERS_ENV="$PROJECT_ROOT/.env.local"

if [ -f "$ROOT_ENV" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT_ENV"
  set +a
  echo "✅ Loaded $ROOT_ENV"
fi
if [ -f "$WORKERS_ENV" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$WORKERS_ENV"
  set +a
  echo "✅ Loaded $WORKERS_ENV"
fi

if [ ! -f "$ROOT_ENV" ] && [ ! -f "$WORKERS_ENV" ]; then
  echo "❌ No .env.local found. Use one or both:"
  echo "   - $ROOT_ENV (app / Amplify vars: EXPO_PUBLIC_SUPABASE_URL, LEADS_SUPABASE_URL, …)"
  echo "   - $WORKERS_ENV (copy from .env.example — CDK_DEFAULT_ACCOUNT, DEV_SUPABASE_URL, PROD_SUPABASE_URL)"
  exit 1
fi

# Match bin/workers.ts: allow main Supabase URL from Expo env name
export DEV_SUPABASE_URL="${DEV_SUPABASE_URL:-$EXPO_PUBLIC_SUPABASE_URL}"

# Verify required variables are set
if [ -z "$CDK_DEFAULT_ACCOUNT" ]; then
  echo "❌ Error: CDK_DEFAULT_ACCOUNT not set in .env.local"
  exit 1
fi

if [ -z "$DEV_SUPABASE_URL" ]; then
  echo "❌ Error: DEV_SUPABASE_URL not set (set it or set EXPO_PUBLIC_SUPABASE_URL for the main app project)"
  exit 1
fi

# Same app defines WorkerStack-Prod; optional for local dev (falls back to dev URL)
if [ -z "$PROD_SUPABASE_URL" ]; then
  export PROD_SUPABASE_URL="$DEV_SUPABASE_URL"
  echo "⚠️  PROD_SUPABASE_URL unset; using DEV_SUPABASE_URL for WorkerStack-Prod (set PROD_SUPABASE_URL for real prod)"
fi

# Export for use in commands
export CDK_DEFAULT_ACCOUNT
export CDK_DEFAULT_REGION
export DEV_SUPABASE_URL
export PROD_SUPABASE_URL

# Optional: warn if Slack error webhook is not set (workers will not report errors to Slack)
if [ -z "$DEV_SLACK_ERROR_WEBHOOK_URL" ] && [ -z "$SLACK_ERROR_WEBHOOK_URL" ]; then
  echo "⚠️  Slack error reporting disabled: set DEV_SLACK_ERROR_WEBHOOK_URL (or SLACK_ERROR_WEBHOOK_URL) in .env.local and redeploy to enable."
fi
if [ -z "$PROD_SLACK_ERROR_WEBHOOK_URL" ] && [ -z "$SLACK_ERROR_WEBHOOK_URL" ]; then
  echo "⚠️  Slack (prod) disabled: set PROD_SLACK_ERROR_WEBHOOK_URL (or SLACK_ERROR_WEBHOOK_URL) in .env.local and redeploy for prod workers."
fi

echo "✅ Environment ready for CDK"

if [ -z "${DEV_SECRET_SSM_PREFIX:-}" ] || [ -z "${PROD_SECRET_SSM_PREFIX:-}" ]; then
  echo "⚠️  CDK requires DEV_SECRET_SSM_PREFIX and PROD_SECRET_SSM_PREFIX in .env.local (SSM parent path; no defaults). See docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md"
fi

# Execute all remaining arguments as a command
exec "$@"

