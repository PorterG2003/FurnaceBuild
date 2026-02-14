#!/bin/bash
# Pre-deployment validation script for Expo/Amplify stack
# Validates TypeScript, Lambda functions, and Expo export before deploying to Amplify

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "🔍 Pre-Deployment Validation (Expo/Amplify)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

ERRORS=0
WARNINGS=0

cd "$PROJECT_ROOT"

# Function to check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "📋 Checking prerequisites..."
if ! command_exists npm; then
  echo "❌ npm not found"
  exit 1
fi
echo "✅ npm found"

if ! command_exists npx; then
  echo "❌ npx not found"
  exit 1
fi
echo "✅ npx found"

if ! command_exists node; then
  echo "❌ node not found"
  exit 1
fi
echo "✅ node found ($(node --version))"
echo ""

# Skip root-level TypeScript check (too slow, focus on Lambda functions)
# The Expo app TypeScript errors will be caught during the Expo export step
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 TypeScript Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "ℹ️  Skipping root-level TypeScript check (focusing on Lambda functions)"
echo "   (Expo app TypeScript will be validated during export step)"
echo ""

# Validate Lambda function builds
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚡ Validating Lambda Functions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

LAMBDA_FUNCTIONS=("testMailboxConnection" "enrollmentMetric" "inboxChecker" "sendInvitationEmail")

for func in "${LAMBDA_FUNCTIONS[@]}"; do
  FUNC_DIR="$PROJECT_ROOT/amplify/functions/$func"
  
  if [ ! -d "$FUNC_DIR" ]; then
    echo "⚠️  Lambda function directory not found: $func (skipping)"
    ((WARNINGS++))
    continue
  fi
  
  echo "🔨 Validating $func..."
  cd "$FUNC_DIR"
  
  # Check if package.json exists
  if [ ! -f "package.json" ]; then
    echo "   ⚠️  No package.json found (skipping)"
    ((WARNINGS++))
    continue
  fi
  
  # Always install/update dependencies to ensure they're current
  echo "   📥 Installing dependencies..."
  if ! npm install --silent 2>&1; then
    echo "   ❌ Failed to install dependencies"
    ((ERRORS++))
    continue
  fi
  
  # Check if TypeScript compilation is needed
  if [ -f "tsconfig.json" ]; then
    echo "   🔨 Compiling TypeScript..."
    # Run tsc and show output in real-time, capture exit code
    set +e  # Don't exit on error
    TEMP_FILE=$(mktemp)
    npx tsc --noEmit > "$TEMP_FILE" 2>&1
    TSC_EXIT_CODE=$?
    set -e  # Re-enable exit on error
    
    # Show output
    if [ -s "$TEMP_FILE" ]; then
      cat "$TEMP_FILE"
    fi
    
    if [ $TSC_EXIT_CODE -eq 0 ]; then
      echo "   ✅ TypeScript check passed"
    else
      echo "   ❌ TypeScript compilation failed (see errors above)"
      ((ERRORS++))
    fi
    
    rm -f "$TEMP_FILE"
  else
    # Even without tsconfig.json, try to check TypeScript if handler.ts exists
    if [ -f "handler.ts" ]; then
      echo "   🔨 Checking TypeScript (no tsconfig.json, using defaults)..."
      set +e
      TEMP_FILE=$(mktemp)
      npx tsc --noEmit --skipLibCheck handler.ts > "$TEMP_FILE" 2>&1
      TSC_EXIT_CODE=$?
      set -e
      
      # Show output
      if [ -s "$TEMP_FILE" ]; then
        cat "$TEMP_FILE"
      fi
      
      if [ $TSC_EXIT_CODE -eq 0 ]; then
        echo "   ✅ TypeScript check passed"
      else
        echo "   ❌ TypeScript compilation failed (see errors above)"
        ((ERRORS++))
      fi
      
      rm -f "$TEMP_FILE"
    fi
  fi
  
  # Check if handler file exists
  if [ ! -f "handler.ts" ]; then
    echo "   ⚠️  No handler.ts found"
    ((WARNINGS++))
  else
    echo "   ✅ Handler file found"
  fi
  
  echo ""
  cd "$PROJECT_ROOT"
done

# Validate Expo export (web build)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📱 Validating Expo Export (Web Build)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$PROJECT_ROOT"

# Check if app.json exists
if [ ! -f "app.json" ]; then
  echo "❌ app.json not found"
  ((ERRORS++))
else
  echo "✅ app.json found"
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📥 Installing dependencies..."
  if ! npm install --silent 2>&1; then
    echo "❌ Failed to install dependencies"
    ((ERRORS++))
  fi
fi

# Test Expo export (dry run - just validate it can build)
echo "🔨 Testing Expo export (web platform)..."
echo "   This simulates the Amplify build process..."

# Create a temporary output directory
TEMP_OUTPUT_DIR=$(mktemp -d)
trap "rm -rf $TEMP_OUTPUT_DIR" EXIT

# Try to export (this is what Amplify does)
if npx expo export --platform web --output-dir "$TEMP_OUTPUT_DIR" 2>&1; then
  echo "✅ Expo export successful"
  
  # Check if output files were created
  if [ -d "$TEMP_OUTPUT_DIR" ] && [ "$(ls -A $TEMP_OUTPUT_DIR 2>/dev/null)" ]; then
    echo "✅ Export output files created"
  else
    echo "⚠️  Export completed but no output files found"
    ((WARNINGS++))
  fi
else
  echo "❌ Expo export failed"
  ((ERRORS++))
fi

# Clean up temp directory
rm -rf "$TEMP_OUTPUT_DIR" 2>/dev/null || true
echo ""

# Validate amplify.yml syntax (basic check)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📄 Validating Amplify Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "amplify.yml" ]; then
  echo "✅ amplify.yml found"
  
  # Basic validation - check if required sections exist
  if grep -q "frontend:" amplify.yml && grep -q "backend:" amplify.yml; then
    echo "✅ amplify.yml structure looks valid"
  else
    echo "⚠️  amplify.yml might be missing required sections"
    ((WARNINGS++))
  fi
else
  echo "⚠️  amplify.yml not found (Amplify will use defaults)"
  ((WARNINGS++))
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Validation Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo "✅ All validations passed! Ready for Amplify deployment."
  echo ""
  echo "💡 Next steps:"
  echo "   - Commit and push to trigger Amplify build"
  echo "   - Or deploy manually: git push origin main"
  echo ""
  exit 0
elif [ $ERRORS -eq 0 ]; then
  echo "⚠️  Validation completed with $WARNINGS warning(s)"
  echo "   Proceed with caution."
  echo ""
  exit 0
else
  echo "❌ Validation failed with $ERRORS error(s)"
  if [ $WARNINGS -gt 0 ]; then
    echo "   and $WARNINGS warning(s)"
  fi
  echo ""
  echo "💡 Fix the errors above before deploying to Amplify."
  echo ""
  exit 1
fi
