#!/usr/bin/env bash
# Wait until nameSuggestions is healthy, then resume the full scrape.
# Keeps probes gentle so we do not deepen a soft-ban.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="${1:-output/runs/us-ca-full}"
RATE_MS="${RATE_MS:-2500}"
LOG="$ROOT/$RUN_DIR/console.log"
mkdir -p "$ROOT/$RUN_DIR"

probe() {
  cd "$ROOT"
  npx tsx -e '
import { launchExpBrowser, closeExpBrowser, openCountryPage } from "./src/browser.ts";
import { harvestNameSuggestions } from "./src/graphql.ts";
async function main() {
  const s = await launchExpBrowser(true);
  try {
    await openCountryPage(s.page, "US");
    const names = await harvestNameSuggestions(s.page, "sm", "US");
    if (!names.length) {
      console.log("PROBE_EMPTY");
      process.exit(3);
    }
    console.log("PROBE_OK", names.length, names.slice(0, 2).join(" | "));
  } finally {
    await closeExpBrowser(s);
  }
}
main().catch((e) => {
  console.error("PROBE_FAIL", e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(2);
});
'
}

echo "===== wait-and-scrape $(date -u +%Y-%m-%dT%H:%M:%SZ) =====" | tee -a "$LOG"
attempt=0
while true; do
  attempt=$((attempt + 1))
  echo "[wait] probe attempt=${attempt} $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG"
  set +e
  out="$(probe 2>&1)"
  code=$?
  set -e
  echo "$out" | tee -a "$LOG"
  if [[ $code -eq 0 ]]; then
    break
  fi
  # Soft-ban recovery: long quiet gaps. Do not hammer.
  sleep_for=$(( attempt < 2 ? 300 : attempt < 5 ? 900 : 1800 ))
  echo "[wait] unhealthy; sleeping ${sleep_for}s" | tee -a "$LOG"
  sleep "$sleep_for"
done

echo "[wait] healthy — starting scrape rateMs=${RATE_MS}" | tee -a "$LOG"
cd "$ROOT"
# Outer loop: if scrape dies on browser close / rate limit, wait and resume.
for round in 1 2 3 4 5 6 7 8 9 10; do
  echo "[wait] scrape round=${round} $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG"
  set +e
  npm run scrape -- --resume --country both --rate-ms "$RATE_MS" --run-dir "$RUN_DIR" >>"$LOG" 2>&1
  code=$?
  set -e
  if [[ $code -eq 0 ]]; then
    echo "[wait] scrape finished ok at $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG"
    exit 0
  fi
  echo "[wait] scrape exited ${code}; cooling 600s then resume" | tee -a "$LOG"
  sleep 600
done
echo "[wait] giving up after scrape rounds at $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG"
exit 1
