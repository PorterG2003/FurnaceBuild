#!/bin/bash
# Sync dev branch schema from main, then apply migrations

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
INFRA_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../../.." && pwd )"

# Load environment variables
ENV_FILE="$INFRA_DIR/.env.local"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

echo "🔄 Syncing Dev Branch from Main"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get project refs
DEV_URL="${DEV_SUPABASE_URL}"
PROD_URL="${PROD_SUPABASE_URL}"

if [[ "$DEV_URL" =~ https://([^.]+)\.supabase\.co ]]; then
  DEV_PROJECT_REF="${BASH_REMATCH[1]}"
else
  echo "❌ Could not extract dev project ref from DEV_SUPABASE_URL"
  exit 1
fi

if [[ "$PROD_URL" =~ https://([^.]+)\.supabase\.co ]]; then
  PROD_PROJECT_REF="${BASH_REMATCH[1]}"
else
  echo "❌ Could not extract prod project ref from PROD_SUPABASE_URL"
  exit 1
fi

echo "📋 Project Refs:"
echo "   Main/Prod: $PROD_PROJECT_REF"
echo "   Dev: $DEV_PROJECT_REF"
echo ""

cd "$PROJECT_ROOT"

# Step 1: Link to main and pull schema
echo "1️⃣  Linking to main branch and pulling schema..."
supabase link --project-ref "$PROD_PROJECT_REF" 2>/dev/null || echo "   (Already linked to main)"

echo ""
echo "2️⃣  Pulling current schema from main..."
if supabase db pull --linked 2>&1; then
  echo "   ✅ Schema pulled from main"
else
  echo "   ⚠️  Could not pull schema (might be fine if migrations are up to date)"
fi
echo ""

# Step 2: Link to dev
echo "3️⃣  Linking to dev branch..."
supabase link --project-ref "$DEV_PROJECT_REF" 2>/dev/null || echo "   (Already linked to dev)"
echo ""

# Step 3: Check migration status
echo "4️⃣  Checking migration status..."
MIGRATION_STATUS=$(supabase migration list --linked 2>&1 || echo "")

echo "$MIGRATION_STATUS"
echo ""

# Step 4: Push all migrations
echo "5️⃣  Pushing all migrations to dev (this may take a while)..."
echo "   Using --include-all to ensure all migrations are applied"
echo ""

# Try with --include-all first
if supabase db push --include-all --linked 2>&1; then
  echo ""
  echo "✅ Migrations pushed successfully!"
else
  echo ""
  echo "⚠️  First attempt failed, trying alternative approach..."
  echo ""
  
  # Alternative: Try to repair migration history first
  echo "   Attempting to repair migration history..."
  supabase migration repair --status applied 2>/dev/null || echo "   (Repair not needed or not available)"
  echo ""
  
  # Try push again
  echo "   Retrying migration push..."
  if supabase db push --include-all --linked 2>&1; then
    echo ""
    echo "✅ Migrations pushed successfully!"
  else
    echo ""
    echo "❌ Still failing. The dev branch might need to be reset."
    echo ""
    echo "💡 Options:"
    echo "   1. Delete and recreate the dev branch in Supabase Dashboard"
    echo "   2. Or manually apply migrations via SQL Editor (starting from earliest)"
    echo ""
    exit 1
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Migration sync complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Next steps:"
echo "   1. Verify migrations: npm run verify:migrations"
echo "   2. Set secret: npm run set-secret:dev"
echo "   3. Restart workers: npm run restart:dev"
echo ""
