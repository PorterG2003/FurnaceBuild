#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--worker" ]]; then
  RUN_DIR="$2"
  RATE_MS="$3"
  PROFILE="$4"
  CDP_URL="${5:-}"
  cd "$ROOT"
  echo "[supervisor] started at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[supervisor] runDir=$RUN_DIR rateMs=$RATE_MS profile=$PROFILE cdpUrl=${CDP_URL:-none}"
  round=0
  while true; do
    round=$((round + 1))
    echo "[supervisor] scrape round=$round at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    set +e
    browser_args=(--user-data-dir "$PROFILE" --headed)
    if [[ -n "$CDP_URL" ]]; then
      browser_args=(--cdp-url "$CDP_URL" --headed)
    fi
    npm run scrape -- \
      --resume \
      --country both \
      --rate-ms "$RATE_MS" \
      --run-dir "$RUN_DIR" \
      "${browser_args[@]}"
    code=$?
    set -e
    if [[ $code -eq 0 ]]; then
      echo "EXP_RUN_FINISHED_OK $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      exit 0
    fi
    cool_seconds=$(( round < 3 ? 300 : round < 6 ? 900 : 2700 ))
    echo "[supervisor] scrape exited=$code; sleeping=${cool_seconds}s before resume"
    sleep "$cool_seconds"
  done
fi

RUN_DIR="${1:-output/runs/us-ca-enumeration}"
RATE_MS="${RATE_MS:-15000}"
PROFILE="${EXP_CHROME_PROFILE:-$ROOT/output/.chrome-profile}"
CDP_URL="${EXP_CDP_URL:-}"

if [[ "$RUN_DIR" = /* ]]; then
  RUN_PATH="$RUN_DIR"
else
  RUN_PATH="$ROOT/$RUN_DIR"
fi
mkdir -p "$RUN_PATH"

LOG="$RUN_PATH/console.log"
PID_FILE="$RUN_PATH/scraper.pid"

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(tr -dc '0-9' < "$PID_FILE")"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "Already running pid=$existing_pid log=$LOG"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

touch "$LOG"
worker=("$0" --worker "$RUN_DIR" "$RATE_MS" "$PROFILE" "$CDP_URL")

if command -v setsid >/dev/null 2>&1; then
  nohup setsid "${worker[@]}" </dev/null >>"$LOG" 2>&1 &
  pid=$!
else
  # macOS does not ship setsid. Node's detached spawn creates a new process
  # group/session and survives the launching terminal.
  pid="$(
    node --input-type=module - "$LOG" "${worker[@]}" <<'NODE'
import { openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [logPath, command, ...args] = process.argv.slice(2);
const output = openSync(logPath, 'a');
const child = spawn(command, args, {
  detached: true,
  stdio: ['ignore', output, output],
  env: process.env,
});
closeSync(output);
child.unref();
process.stdout.write(String(child.pid));
NODE
  )"
fi

printf '%s\n' "$pid" >"$PID_FILE"
echo "Started pid=$pid log=$LOG"
