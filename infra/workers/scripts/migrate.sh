#!/bin/bash
# Run Supabase migrations for app and/or leads databases in dev or prod.

set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
INFRA_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../../.." && pwd )"
ROOT_ENV="$PROJECT_ROOT/.env.local"
WORKERS_ENV="$INFRA_DIR/.env.local"

ENVIRONMENT="${1:-}"
TARGET="${2:-all}"

usage() {
  echo "Usage: bash scripts/migrate.sh [dev|prod] [app|leads|all]"
  echo ""
  echo "Examples:"
  echo "  bash scripts/migrate.sh dev app"
  echo "  bash scripts/migrate.sh dev leads"
  echo "  bash scripts/migrate.sh dev all"
  echo "  bash scripts/migrate.sh prod all"
}

load_env() {
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
    echo "   - $ROOT_ENV"
    echo "   - $WORKERS_ENV"
    exit 1
  fi

  export DEV_SUPABASE_URL="${DEV_SUPABASE_URL:-${EXPO_PUBLIC_SUPABASE_URL:-}}"
  export DEV_LEADS_SUPABASE_URL="${DEV_LEADS_SUPABASE_URL:-${LEADS_SUPABASE_URL_DEV:-${LEADS_SUPABASE_URL:-}}}"
  export PROD_LEADS_SUPABASE_URL="${PROD_LEADS_SUPABASE_URL:-${LEADS_SUPABASE_URL_PROD:-}}"
}

check_supabase_cli() {
  if ! command -v supabase >/dev/null 2>&1; then
    echo "❌ Supabase CLI not found"
    echo "Install it with: npm install -g supabase"
    exit 1
  fi
}

ensure_supabase_login() {
  if supabase projects list >/dev/null 2>&1; then
    return 0
  fi

  echo "⚠️  Supabase CLI is not authenticated."

  if [ -t 0 ] && [ -t 1 ]; then
    echo "Opening Supabase login..."
    supabase login
    return $?
  fi

  echo "Run 'supabase login' first, then rerun this command."
  return 1
}

extract_project_ref() {
  local url="$1"

  if [[ "$url" =~ ^https://([^.]+)\.supabase\.co/?$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

run_supabase() {
  local target="$1"
  shift

  if [ "$target" = "leads" ]; then
    (
      cd "$PROJECT_ROOT" &&
      supabase --workdir supabase-leads "$@"
    )
  else
    (
      cd "$PROJECT_ROOT" &&
      supabase "$@"
    )
  fi
}

resolve_url() {
  local environment="$1"
  local target="$2"

  if [ "$target" = "app" ]; then
    if [ "$environment" = "dev" ]; then
      echo "${DEV_SUPABASE_URL:-}"
    else
      echo "${PROD_SUPABASE_URL:-}"
    fi
    return 0
  fi

  if [ "$environment" = "dev" ]; then
    echo "${DEV_LEADS_SUPABASE_URL:-}"
  else
    echo "${PROD_LEADS_SUPABASE_URL:-}"
  fi
}

resolve_migrations_dir() {
  local target="$1"

  if [ "$target" = "leads" ]; then
    echo "$PROJECT_ROOT/supabase-leads/supabase/migrations"
  else
    echo "$PROJECT_ROOT/supabase/migrations"
  fi
}

run_single() {
  local environment="$1"
  local target="$2"
  local label db_url project_ref migrations_dir migration_count

  label="${environment}/${target}"
  db_url="$(resolve_url "$environment" "$target")"
  migrations_dir="$(resolve_migrations_dir "$target")"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📦 Running migrations for ${label}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if [ ! -d "$migrations_dir" ]; then
    echo "❌ Migrations directory not found: $migrations_dir"
    return 1
  fi

  migration_count=$(find "$migrations_dir" -name "*.sql" | wc -l | tr -d ' ')
  echo "📋 Found $migration_count migration file(s)"

  if [ -z "$db_url" ]; then
    echo "❌ Missing Supabase URL for ${label}"
    if [ "$target" = "app" ] && [ "$environment" = "dev" ]; then
      echo "   Set DEV_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL"
    elif [ "$target" = "app" ]; then
      echo "   Set PROD_SUPABASE_URL"
    elif [ "$environment" = "dev" ]; then
      echo "   Set DEV_LEADS_SUPABASE_URL, LEADS_SUPABASE_URL_DEV, or LEADS_SUPABASE_URL"
    else
      echo "   Set PROD_LEADS_SUPABASE_URL or LEADS_SUPABASE_URL_PROD"
    fi
    return 1
  fi

  if ! project_ref="$(extract_project_ref "$db_url")"; then
    echo "❌ Could not parse project ref from URL: $db_url"
    return 1
  fi

  echo "🔗 Target project ref: $project_ref"

  if ! run_supabase "$target" link --project-ref "$project_ref"; then
    echo "❌ Failed to link ${label} to project $project_ref"
    return 1
  fi

  echo "📤 Pushing migrations..."
  if run_supabase "$target" db push --include-all; then
    echo "✅ ${label} migrations pushed successfully"
    return 0
  fi

  echo "❌ ${label} migrations failed"
  return 1
}

run_all() {
  local environment="$1"
  local failures=0
  local failed_targets=()

  if ! run_single "$environment" "app"; then
    failures=$((failures + 1))
    failed_targets+=("app")
  fi

  if ! run_single "$environment" "leads"; then
    failures=$((failures + 1))
    failed_targets+=("leads")
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📋 Migration summary for ${environment}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if [ "$failures" -eq 0 ]; then
    echo "✅ app: success"
    echo "✅ leads: success"
    echo "✅ All migrations completed successfully"
    return 0
  fi

  if [[ " ${failed_targets[*]} " =~ " app " ]]; then
    echo "❌ app: failed"
  else
    echo "✅ app: success"
  fi

  if [[ " ${failed_targets[*]} " =~ " leads " ]]; then
    echo "❌ leads: failed"
  else
    echo "✅ leads: success"
  fi

  echo "❌ Completed with ${failures} failure(s)"
  return 1
}

main() {
  if [[ "$ENVIRONMENT" != "dev" && "$ENVIRONMENT" != "prod" ]]; then
    usage
    exit 1
  fi

  if [[ "$TARGET" != "app" && "$TARGET" != "leads" && "$TARGET" != "all" ]]; then
    usage
    exit 1
  fi

  load_env
  check_supabase_cli

  if ! ensure_supabase_login; then
    exit 1
  fi

  if [ "$TARGET" = "all" ]; then
    run_all "$ENVIRONMENT"
  else
    run_single "$ENVIRONMENT" "$TARGET"
  fi
}

main "$@"
