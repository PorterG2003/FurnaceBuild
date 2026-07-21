#!/usr/bin/env bash
# Unattended Apify recovery loop.
# Runs the batch in --resume mode; on a #613 HEALTH_HALT (exit 2) it waits a long
# cooldown and relaunches, until every unique domain is complete.
set -u

cd "$(dirname "$0")"

OUT_DIR="${OUT_DIR:-../../../../scripts/lead-sourcing/webinar-hosts/output/runs/2026-07-15-meta-ads-linkedin-jul08-new}"
CHECKPOINT="${OUT_DIR}/apify-batch-checkpoint.json"
LOG="${OUT_DIR}/recovery.log"
INPUT_CSV="${INPUT_CSV:-${OUT_DIR}/input.csv}"
TARGET_DOMAINS="${TARGET_DOMAINS:-1414}"

# Tunables
COOLDOWN_SECONDS="${COOLDOWN_SECONDS:-2700}"      # 45 min after a hard #613 halt
CRASH_COOLDOWN_SECONDS="${CRASH_COOLDOWN_SECONDS:-300}"
DELAY_MS="${DELAY_MS:-4000}"
RATE_LIMIT_BACKOFF_MS="${RATE_LIMIT_BACKOFF_MS:-360000}"  # 6 min in-run before handing to loop
RATE_LIMIT_MAX_RETRIES="${RATE_LIMIT_MAX_RETRIES:-2}"
# Hybrid: screen with official (never #613 on empties); enrich hits with leadsbrary.
SCREEN_ACTOR="${SCREEN_ACTOR:-official}"
MAX_CYCLES="${MAX_CYCLES:-60}"

completed_count() {
  node -e "try{const c=require('${CHECKPOINT}');process.stdout.write(String(c.completedDomains.length))}catch(e){process.stdout.write('0')}" 2>/dev/null || echo 0
}

cycle=0
while [ "$cycle" -lt "$MAX_CYCLES" ]; do
  cycle=$((cycle + 1))
  done_now="$(completed_count)"
  echo "[loop] cycle ${cycle} — ${done_now}/${TARGET_DOMAINS} complete — launching resume $(date)" | tee -a "$LOG"

  if [ "$done_now" -ge "$TARGET_DOMAINS" ]; then
    echo "[loop] all ${TARGET_DOMAINS} domains complete — done" | tee -a "$LOG"
    exit 0
  fi

  SCREEN_ARGS=()
  if [ -n "$SCREEN_ACTOR" ] && [ "$SCREEN_ACTOR" != "off" ]; then
    SCREEN_ARGS=(--screen-actor "$SCREEN_ACTOR")
  fi

  # Fresh start when no checkpoint exists yet; otherwise resume.
  if [ -f "$CHECKPOINT" ]; then
    MODE_FLAG=(--resume)
    MODE_LABEL=resume
  else
    MODE_FLAG=(--fresh)
    MODE_LABEL=fresh
  fi
  echo "[loop] mode=${MODE_LABEL}" | tee -a "$LOG"

  node --import tsx src/batchApifyPilot.ts --all "${MODE_FLAG[@]}" \
    --out-dir "$OUT_DIR" \
    --delay-ms "$DELAY_MS" \
    --rate-limit-backoff-ms "$RATE_LIMIT_BACKOFF_MS" \
    --rate-limit-max-retries "$RATE_LIMIT_MAX_RETRIES" \
    "${SCREEN_ARGS[@]}" \
    "$INPUT_CSV" \
    2>&1 | tee -a "$LOG"
  ec="${PIPESTATUS[0]}"

  done_now="$(completed_count)"
  if [ "$done_now" -ge "$TARGET_DOMAINS" ]; then
    echo "[loop] all ${TARGET_DOMAINS} domains complete — done" | tee -a "$LOG"
    exit 0
  fi

  if [ "$ec" -eq 0 ]; then
    echo "[loop] batch exited 0 but ${done_now}/${TARGET_DOMAINS} — short pause then continue" | tee -a "$LOG"
    sleep "$CRASH_COOLDOWN_SECONDS"
  elif [ "$ec" -eq 2 ]; then
    echo "[loop] HEALTH_HALT (#613). Cooling down ${COOLDOWN_SECONDS}s before resume $(date)" | tee -a "$LOG"
    sleep "$COOLDOWN_SECONDS"
  else
    echo "[loop] unexpected exit ${ec}. Cooling down ${CRASH_COOLDOWN_SECONDS}s $(date)" | tee -a "$LOG"
    sleep "$CRASH_COOLDOWN_SECONDS"
  fi
done

echo "[loop] reached MAX_CYCLES=${MAX_CYCLES} — stopping. Resume manually if not complete." | tee -a "$LOG"
exit 1
