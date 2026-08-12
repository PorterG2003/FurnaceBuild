#!/usr/bin/env bash
# Start a normal (non-Playwright) Chrome with remote debugging so the scraper
# can attach via --cdp-url and inherit a real-browser reCAPTCHA score.
set -euo pipefail
PORT="${1:-9222}"
PROFILE="${2:-/tmp/exp-realty-chrome-profile}"
mkdir -p "$PROFILE"
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  "https://www.exprealty.com/agents-search?country=US"
