#!/usr/bin/env sh
set -eu

echo "website-verification-entrypoint-start"
DISPLAY_NUM="${DISPLAY:-:99}"
XVFB_LOG="/tmp/website-verification-xvfb.log"

cleanup() {
  if [ -n "${XVFB_PID:-}" ] && kill -0 "$XVFB_PID" 2>/dev/null; then
    kill "$XVFB_PID" 2>/dev/null || true
    wait "$XVFB_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "website-verification-xvfb-start:$DISPLAY_NUM"
Xvfb "$DISPLAY_NUM" -screen 0 1280x720x24 >"$XVFB_LOG" 2>&1 &
XVFB_PID=$!
sleep 1

if ! kill -0 "$XVFB_PID" 2>/dev/null; then
  echo "website-verification-xvfb-start-failed"
  if [ -s "$XVFB_LOG" ]; then
    sed -n '1,120p' "$XVFB_LOG"
  fi
  exit 1
fi

export DISPLAY="$DISPLAY_NUM"

echo "website-verification-node-version:$(node --version)"
exec node --import tsx src/index.ts
