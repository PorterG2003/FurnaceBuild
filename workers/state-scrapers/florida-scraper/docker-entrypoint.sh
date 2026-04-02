#!/usr/bin/env sh
set -eu
# First line to CloudWatch before Xvfb / Node; if missing, wrong stream or entrypoint not used.
echo "florida-entrypoint-start"
DISPLAY_NUM="${DISPLAY:-:99}"
XVFB_LOG="/tmp/florida-xvfb.log"

cleanup() {
  if [ -n "${XVFB_PID:-}" ] && kill -0 "$XVFB_PID" 2>/dev/null; then
    kill "$XVFB_PID" 2>/dev/null || true
    wait "$XVFB_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "florida-xvfb-start:$DISPLAY_NUM"
Xvfb "$DISPLAY_NUM" -screen 0 1280x720x24 >"$XVFB_LOG" 2>&1 &
XVFB_PID=$!
echo "florida-xvfb-pid:$XVFB_PID"
sleep 1

if ! kill -0 "$XVFB_PID" 2>/dev/null; then
  echo "florida-xvfb-start-failed"
  if [ -s "$XVFB_LOG" ]; then
    sed -n '1,120p' "$XVFB_LOG"
  fi
  exit 1
fi

export DISPLAY="$DISPLAY_NUM"

echo "florida-inner-shell-start"
echo "florida-display:$DISPLAY"
echo "florida-node-binary:$(command -v node || echo missing)"
echo "florida-chrome-binary:$(command -v google-chrome || echo missing)"
echo "florida-node-version:$(node --version)"
node --import tsx -e "console.log('florida-tsx-loader-start')"
if [ "${RUN_MODE:-}" = "reconciliation" ]; then
  exec node --import tsx src/run-reconciliation-bootstrap.ts
else
  exec node --import tsx src/run.ts "$INPUT_CSV" --out "$OUTPUT_JSON"
fi
