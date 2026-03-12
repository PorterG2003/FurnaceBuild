#!/bin/bash
# Pre-deployment validation script
# Validates TypeScript builds and Docker builds before pushing to production

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
INFRA_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../../.." && pwd )"

echo "🔍 Pre-Deployment Validation"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

ERRORS=0
WARNINGS=0

# Function to check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "📋 Checking prerequisites..."
if ! command_exists docker; then
  echo "❌ Docker not found - Docker builds will be skipped"
  SKIP_DOCKER=true
else
  echo "✅ Docker found"
  SKIP_DOCKER=false
fi

if ! command_exists npm; then
  echo "❌ npm not found"
  exit 1
fi
echo "✅ npm found"
echo ""

# Validate TypeScript builds for all workers
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 Validating TypeScript Builds"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

TS_WORKERS=("send-worker" "scheduler-worker" "inbox-checker-worker")
DOCKER_WORKERS=("send-worker" "scheduler-worker" "inbox-checker-worker" "smartlead-migration-task")

for worker in "${TS_WORKERS[@]}"; do
  WORKER_DIR="$PROJECT_ROOT/workers/$worker"
  
  if [ ! -d "$WORKER_DIR" ]; then
    echo "⚠️  Worker directory not found: $worker (skipping)"
    ((WARNINGS++))
    continue
  fi
  
  echo "🔨 Building $worker..."
  cd "$WORKER_DIR"
  
  # Check if package.json exists
  if [ ! -f "package.json" ]; then
    echo "   ⚠️  No package.json found (skipping)"
    ((WARNINGS++))
    continue
  fi
  
  # Install dependencies if node_modules doesn't exist
  if [ ! -d "node_modules" ]; then
    echo "   📥 Installing dependencies..."
    if ! npm install --silent; then
      echo "   ❌ Failed to install dependencies"
      ((ERRORS++))
      continue
    fi
  fi
  
  # Run TypeScript build
  if npm run build 2>&1; then
    echo "   ✅ TypeScript build successful"
  else
    echo "   ❌ TypeScript build failed"
    ((ERRORS++))
  fi
  echo ""
done

# Validate Docker builds (without pushing)
if [ "$SKIP_DOCKER" = false ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🐳 Validating Docker Builds"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  
  cd "$PROJECT_ROOT"
  
  # Set up buildx if needed
  if ! docker buildx ls | grep -q multiarch-builder; then
    echo "🔧 Setting up Docker buildx..."
    docker buildx create --use --name multiarch-builder 2>/dev/null || docker buildx use multiarch-builder
  fi
  
  for worker in "${DOCKER_WORKERS[@]}"; do
    WORKER_DIR="$PROJECT_ROOT/workers/$worker"
    DOCKERFILE="$WORKER_DIR/Dockerfile"
    
    if [ ! -f "$DOCKERFILE" ]; then
      echo "⚠️  Dockerfile not found for $worker (skipping)"
      ((WARNINGS++))
      continue
    fi
    
    echo "🐳 Building Docker image for $worker..."
    
    # Build without pushing (--load for local testing)
    if docker buildx build \
      --platform linux/amd64 \
      -f "$DOCKERFILE" \
      -t "furnace/$worker:validate" \
      --load \
      "$PROJECT_ROOT" 2>&1; then
      echo "   ✅ Docker build successful"
      
      # Clean up test image
      docker rmi "furnace/$worker:validate" 2>/dev/null || true
    else
      echo "   ❌ Docker build failed"
      ((ERRORS++))
    fi
    echo ""
  done
else
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🐳 Docker Build Validation (Skipped - Docker not available)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
fi

# Validate CDK infrastructure
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏗️  Validating CDK Infrastructure"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$INFRA_DIR"

# Check if TypeScript compiles
echo "🔨 Building CDK TypeScript..."
if npm run build 2>&1; then
  echo "✅ CDK TypeScript build successful"
else
  echo "❌ CDK TypeScript build failed"
  ((ERRORS++))
fi
echo ""

# Synthesize stacks to check for errors
echo "🔍 Synthesizing CDK stacks..."
for env in dev prod; do
  echo "   Synthesizing $env stack..."
  if npm run synth:$env 2>&1 | grep -q "Successfully synthesized"; then
    echo "   ✅ $env stack synthesized successfully"
  else
    # Check if synth actually succeeded (grep might fail if output format differs)
    if npm run synth:$env >/dev/null 2>&1; then
      echo "   ✅ $env stack synthesized successfully"
    else
      echo "   ❌ $env stack synthesis failed"
      ((ERRORS++))
    fi
  fi
done
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Validation Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo "✅ All validations passed! Ready for deployment."
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
  echo "💡 Fix the errors above before deploying to production."
  echo ""
  exit 1
fi
