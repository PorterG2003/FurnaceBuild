#!/bin/bash
# Verify that migrations are applied to dev branch

set -e

echo "🔍 Verifying Database Migrations on Dev Branch"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

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

DEV_SUPABASE_URL="${DEV_SUPABASE_URL}"

if [ -z "$DEV_SUPABASE_URL" ]; then
  echo "❌ DEV_SUPABASE_URL not found in .env.local"
  echo "   Please set it first"
  exit 1
fi

echo "📋 Dev Supabase URL: $DEV_SUPABASE_URL"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To verify migrations, run these SQL queries in Supabase SQL Editor:"
echo ""
echo "1. Switch to 'dev' branch in Supabase Dashboard"
echo "2. Go to SQL Editor"
echo "3. Run these queries:"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Check if column exists:"
echo ""
cat << 'EOF'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'campaigns'
  AND column_name = 'last_completed_interval_time';
EOF

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Check if function exists:"
echo ""
cat << 'EOF'
SELECT 
  proname AS function_name,
  pg_get_function_arguments(oid) AS arguments
FROM pg_proc
WHERE proname = 'check_and_update_processed_intervals'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
EOF

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Expected Results:"
echo "   - Column query should return 1 row with column_name = 'last_completed_interval_time'"
echo "   - Function query should return 1 row with function_name = 'check_and_update_processed_intervals'"
echo ""
echo "If either query returns 0 rows, the migrations haven't been applied yet."
echo ""
