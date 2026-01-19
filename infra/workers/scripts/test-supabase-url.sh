#!/bin/bash
# Test if Supabase URL is reachable

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

DEV_URL="${DEV_SUPABASE_URL}"

if [ -z "$DEV_URL" ]; then
  echo "❌ DEV_SUPABASE_URL not set"
  exit 1
fi

echo "🔍 Testing Supabase URL: $DEV_URL"
echo ""

# Extract hostname
HOSTNAME=$(echo "$DEV_URL" | sed -E 's|https?://([^/]+).*|\1|')

echo "📋 Hostname: $HOSTNAME"
echo ""

# Test DNS resolution
echo "1️⃣  Testing DNS resolution..."
if nslookup "$HOSTNAME" &>/dev/null || host "$HOSTNAME" &>/dev/null || dig "$HOSTNAME" +short &>/dev/null; then
  echo "   ✅ DNS resolution successful"
else
  echo "   ❌ DNS resolution failed - hostname not found"
  echo ""
  echo "   💡 This means the URL might be incorrect."
  echo "   💡 Check Supabase Dashboard → dev branch → Settings → API"
  echo "   💡 Dev branch URLs might have a different format"
  echo ""
fi

echo ""

# Test HTTP connectivity
echo "2️⃣  Testing HTTP connectivity..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$DEV_URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "404" ] || [ "$HTTP_CODE" = "401" ]; then
  echo "   ✅ HTTP connection successful (status: $HTTP_CODE)"
elif [ "$HTTP_CODE" = "000" ]; then
  echo "   ❌ HTTP connection failed (couldn't connect)"
else
  echo "   ⚠️  HTTP connection returned status: $HTTP_CODE"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 If DNS resolution failed:"
echo "   1. Go to Supabase Dashboard"
echo "   2. Switch to 'dev' branch"
echo "   3. Go to Settings → API"
echo "   4. Copy the exact Project URL"
echo "   5. Update .env.local with the correct URL"
echo "   6. Redeploy: npm run deploy:dev"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
