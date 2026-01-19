#!/bin/bash
# Apply database migrations to Supabase dev branch

set -e

echo "📦 Applying Database Migrations to Dev Branch"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
  echo "❌ Supabase CLI not found"
  echo ""
  echo "Install it with:"
  echo "  npm install -g supabase"
  echo ""
  exit 1
fi

echo "✅ Supabase CLI found"
echo ""

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

# Check if migrations directory exists
MIGRATIONS_DIR="$PROJECT_ROOT/supabase/migrations"
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "❌ Migrations directory not found: $MIGRATIONS_DIR"
  exit 1
fi

MIGRATION_COUNT=$(find "$MIGRATIONS_DIR" -name "*.sql" | wc -l | tr -d ' ')
echo "📋 Found $MIGRATION_COUNT migration file(s)"
echo ""

# Check if project is linked
echo "🔍 Checking if project is linked..."
cd "$PROJECT_ROOT"

if [ -f "supabase/.temp/project-ref" ] || [ -f ".supabase/project-ref" ]; then
  echo "✅ Project is linked"
  PROJECT_REF=$(cat supabase/.temp/project-ref 2>/dev/null || cat .supabase/project-ref 2>/dev/null || echo "")
  echo "   Project Ref: $PROJECT_REF"
else
  echo "⚠️  Project not linked yet"
  echo ""
  echo "You need to link your Supabase project first:"
  echo ""
  echo "1. Get your project reference ID:"
  echo "   - Go to Supabase Dashboard → Settings → General"
  echo "   - Copy the 'Reference ID' (looks like: d1jtp0rz0l9mcn)"
  echo ""
  echo "2. Link the project:"
  echo "   cd $(pwd)"
  echo "   supabase link --project-ref <your-project-ref>"
  echo ""
  echo "3. Then run this script again"
  echo ""
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 Migration Options"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "You have two options:"
echo ""
echo "Option 1: Use Supabase CLI (Recommended)"
echo "  - Pushes all pending migrations to dev branch"
echo "  - Command: supabase db push --branch dev"
echo ""
echo "Option 2: Manual SQL Editor (Alternative)"
echo "  - Copy/paste migrations into Supabase SQL Editor"
echo "  - Switch to 'dev' branch first"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "Do you want to push migrations using Supabase CLI? (yes/no): " use_cli

if [ "$use_cli" = "yes" ]; then
  echo ""
  echo "🚀 Pushing migrations to dev branch..."
  echo ""
  
  # Check if we need to login first
  if ! supabase projects list &>/dev/null; then
    echo "⚠️  Not logged in to Supabase CLI"
    echo ""
    echo "Logging in to Supabase..."
    echo "   (This will open a browser window)"
    echo ""
    if ! supabase login; then
      echo "❌ Login failed"
      exit 1
    fi
    echo ""
  fi
  
  # Get dev branch project ref from URL (already loaded above)
  DEV_URL="${DEV_SUPABASE_URL}"
  if [[ "$DEV_URL" =~ https://([^.]+)\.supabase\.co ]]; then
    DEV_PROJECT_REF="${BASH_REMATCH[1]}"
    echo "📋 Detected dev branch project ref: $DEV_PROJECT_REF"
    echo ""
    
    # Try to link to dev branch project
    echo "🔗 Linking to dev branch project..."
    cd "$PROJECT_ROOT"
    
    # Try linking (may fail if already linked to different project, that's ok)
    supabase link --project-ref "$DEV_PROJECT_REF" 2>/dev/null || echo "   (Already linked or will use existing link)"
    echo ""
  fi
  
  # Try to push migrations (use --include-all to apply all migrations, not just new ones)
  echo "📤 Pushing migrations..."
  echo "   Using --include-all flag to apply all migrations from scratch"
  echo ""
  if supabase db push --include-all 2>&1; then
    echo ""
    echo "✅ Migrations pushed successfully!"
  else
    echo ""
    echo "❌ Failed to push migrations"
    echo ""
    echo "💡 Try linking manually:"
    echo "   1. Get your dev branch anon key from Supabase Dashboard → Settings → API"
    echo "   2. Run: supabase link --project-ref $DEV_PROJECT_REF"
    echo "   3. Or use the database URL method (requires DB password):"
    echo "      supabase db push --db-url 'postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres'"
    echo ""
    exit 1
  fi
else
  echo ""
  echo "📋 Manual Migration Instructions"
  echo ""
  echo "1. Go to Supabase Dashboard"
  echo "2. Switch to 'dev' branch (top-left dropdown)"
  echo "3. Go to SQL Editor"
  echo "4. Copy and paste the contents of these migration files (in order):"
  echo ""
  echo "   Key migrations to apply:"
  echo "   - supabase/migrations/20260106201846_add_last_processed_interval_end_to_campaigns.sql"
  echo "   - supabase/migrations/20260107054136_rename_last_processed_interval_end_to_last_completed_interval_time.sql"
  echo ""
  echo "   Or apply all pending migrations from:"
  echo "   $MIGRATIONS_DIR"
  echo ""
  echo "5. Run each migration in the SQL Editor"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅ After applying migrations, verify with:"
  echo ""
  echo "   # Check if column exists"
  echo "   SELECT column_name FROM information_schema.columns"
  echo "   WHERE table_name = 'campaigns'"
  echo "   AND column_name = 'last_completed_interval_time';"
  echo ""
  echo "   # Check if function exists"
  echo "   SELECT proname FROM pg_proc"
  echo "   WHERE proname = 'check_and_update_processed_intervals';"
  echo ""
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
