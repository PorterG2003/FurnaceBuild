#!/bin/bash
# Load environment variables from .env.local file and execute command with them

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

ENV_FILE="$PROJECT_ROOT/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "⚠️  Warning: .env.local not found at $ENV_FILE"
  echo "📝 Copy .env.example to .env.local and fill in your values:"
  echo "   cp $PROJECT_ROOT/.env.example $ENV_FILE"
  exit 1
fi

# Load environment variables
set -a
source "$ENV_FILE"
set +a

# Verify required variables are set
if [ -z "$CDK_DEFAULT_ACCOUNT" ]; then
  echo "❌ Error: CDK_DEFAULT_ACCOUNT not set in .env.local"
  exit 1
fi

if [ -z "$DEV_SUPABASE_URL" ]; then
  echo "❌ Error: DEV_SUPABASE_URL not set in .env.local"
  exit 1
fi

if [ -z "$PROD_SUPABASE_URL" ]; then
  echo "❌ Error: PROD_SUPABASE_URL not set in .env.local"
  exit 1
fi

# Export for use in commands
export CDK_DEFAULT_ACCOUNT
export CDK_DEFAULT_REGION
export DEV_SUPABASE_URL
export PROD_SUPABASE_URL

echo "✅ Environment variables loaded from .env.local"

# Execute all remaining arguments as a command
exec "$@"

