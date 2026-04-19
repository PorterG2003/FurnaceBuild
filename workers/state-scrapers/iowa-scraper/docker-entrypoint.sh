#!/usr/bin/env sh
set -eu

echo "iowa-entrypoint-start"
DISPLAY_NUM="${DISPLAY:-:99}"
XVFB_LOG="/tmp/iowa-xvfb.log"

cleanup() {
  if [ -n "${XVFB_PID:-}" ] && kill -0 "$XVFB_PID" 2>/dev/null; then
    kill "$XVFB_PID" 2>/dev/null || true
    wait "$XVFB_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "iowa-xvfb-start:$DISPLAY_NUM"
Xvfb "$DISPLAY_NUM" -screen 0 1280x720x24 >"$XVFB_LOG" 2>&1 &
XVFB_PID=$!
echo "iowa-xvfb-pid:$XVFB_PID"
sleep 1

if ! kill -0 "$XVFB_PID" 2>/dev/null; then
  echo "iowa-xvfb-start-failed"
  if [ -s "$XVFB_LOG" ]; then
    sed -n '1,120p' "$XVFB_LOG"
  fi
  exit 1
fi

export DISPLAY="$DISPLAY_NUM"

echo "iowa-display:$DISPLAY"
echo "iowa-node-version:$(node --version)"
echo "iowa-chrome-binary:$(command -v google-chrome || echo missing)"

if [ "${RUN_MODE:-}" = "reconciliation" ]; then
  exec node --import tsx src/run-reconciliation.ts
else
  exec node --import tsx src/run-query.ts "${IOWA_QUERY:-Adam Builders}"
fi
