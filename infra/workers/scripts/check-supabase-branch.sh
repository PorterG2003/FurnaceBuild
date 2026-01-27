#!/bin/bash
# Check if Supabase dev branch exists and get its URL

set -e

echo "🔍 Checking Supabase Dev Branch Status"
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

DEV_URL="${DEV_SUPABASE_URL}"

if [ -z "$DEV_URL" ]; then
  echo "❌ DEV_SUPABASE_URL not set in .env.local"
  echo ""
  echo "💡 This means the dev branch might not exist or URL changed."
  echo ""
else
  echo "📋 Current DEV_SUPABASE_URL in .env.local:"
  echo "   $DEV_URL"
  echo ""
  
  # Test if URL is reachable
  HOSTNAME=$(echo "$DEV_URL" | sed -E 's|https?://([^/]+).*|\1|')
  echo "🧪 Testing if URL is reachable..."
  
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$DEV_URL" 2>/dev/null || echo "000")
  
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "404" ] || [ "$HTTP_CODE" = "401" ]; then
    echo "   ✅ URL is reachable (HTTP $HTTP_CODE)"
  else
    echo "   ❌ URL is NOT reachable (HTTP $HTTP_CODE)"
    echo "   💡 The dev branch might not exist or URL is wrong"
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 How to Check/Create Dev Branch in Supabase"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Go to Supabase Dashboard: https://supabase.com/dashboard"
echo ""
echo "2. Select your project"
echo ""
echo "3. Check if 'dev' branch exists:"
echo "   - Look for a branch selector/dropdown (usually top-left)"
echo "   - Or go to Settings → Branches"
echo ""
echo "4. If 'dev' branch does NOT exist (or keeps disappearing):"
echo "   a) Create new branch from 'main':"
echo "      - Click 'New Branch' or 'Create Branch'"
echo "      - Name it 'dev'"
echo "      - Select 'main' as the source branch"
echo ""
echo "   b) ⚠️  IMPORTANT: Make it a PERSISTENT branch (not preview):"
echo "      - After creating the branch, go to Settings → Branches"
echo "      - Find your 'dev' branch"
echo "      - Make sure it's marked as 'Persistent' (not 'Preview')"
echo "      - Persistent branches won't be auto-deleted when merged"
echo ""
echo "   c) Link to GitHub (if needed):"
echo "      - Go to Settings → Integrations → GitHub"
echo "      - Connect the 'dev' branch to your GitHub 'dev' branch"
echo "      - Make sure 'main' is set as the production branch"
echo ""
echo "   d) Check GitHub integration settings:"
echo "      - Ensure 'Automatic Branching' is enabled if you want it"
echo "      - Verify production branch is set correctly"
echo ""
echo "5. Get the new dev branch URL:"
echo "   - Switch to 'dev' branch in Supabase Dashboard"
echo "   - Go to Settings → API"
echo "   - Copy the 'Project URL'"
echo ""
echo "6. Update .env.local:"
echo "   - Edit infra/workers/.env.local"
echo "   - Update DEV_SUPABASE_URL with the new URL"
echo ""
echo "7. Apply migrations:"
echo "   cd infra/workers"
echo "   npm run apply:migrations"
echo ""
echo "8. Set secret and restart:"
echo "   npm run set-secret:dev"
echo "   npm run restart:dev"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
