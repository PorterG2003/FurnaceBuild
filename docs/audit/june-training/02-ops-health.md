# Phase 2 — Inbox Checker Operational Audit

**Generated:** 2026-06-11

## 2A. Infrastructure timeline

| Check | Result |
|-------|--------|
| Inbox-checker ECS (prod) | **1/1 ACTIVE** |
| Send worker | 1/1 ACTIVE |
| Scheduler worker | 1/1 ACTIVE |
| Root cause (Jun 10 outage) | `ERR_MODULE_NOT_FOUND` for `@furnace/mailbox-lib` ESM import (`./imapInbox` vs `./imapInbox.js`) |
| Recovery | ~2026-06-11 21:15 UTC — image rebuild + `npm run scale:prod` |

**Runbook reminder:** CDK deploy sets worker desired count to 0. Always run `npm run scale:prod` after deploy.

## 2B. Polling health

### Platform-wide (393 non-deleted mailboxes)

| Metric | Value |
|--------|------:|
| Connected | 393 |
| Error status | 11 |
| Synced last 10 min | 335 (85%) |
| Synced last 30 min | 338 (86%) |
| Stale >30 min | 66 (17%) |
| Currently claimed | 28 |

**Assessment:** WARN — one worker is keeping up but borderline; ~17% stale at snapshot time. Not the primary explanation for Jun 10–11 zero replies (checker was fully down, not slow).

### June Training 64 mailboxes

| Metric | Value |
|--------|------:|
| Connected | 64 |
| Error status | 0 |
| Synced last 30 min | 64 (100%) |

**Assessment:** PASS at audit time.

### Claim configuration

From [`workers/inbox-checker-worker/src/database.ts`](workers/inbox-checker-worker/src/database.ts):
- Batch size: 50
- Check interval: 5 min
- Processing timeout: 10 min
- Concurrency: 10 IMAP connections per worker

Full cycle estimate: 339 mailboxes / ~50 per batch ≈ 7 batches × few min ≈ **25–35 min** at steady state.

## 2C. Log forensics

CloudWatch log group: `/ecs/furnace/inbox-checker-worker-prod`

Patterns to monitor:
- `Reply to original message detected` — successful reply ingestion
- `has threading headers but doesn't match any sent message` — fetched but unmatched
- `ERR_MODULE_NOT_FOUND` / `FATAL` — service down

**Post-recovery catch-up:** 2 late-ingested replies on `stephanieso@mynexttherapisttoday.com` (Alexa, Clint) ingested at Jun 11 21:17 UTC with 25–40h ingest lag — confirms recovery re-scan works but was not a large backfill.

## Phase 2 scorecard

| Dimension | Status | Notes |
|-----------|--------|-------|
| Service running | PASS | 1/1 after recovery |
| June Training mailbox sync | PASS | 64/64 synced |
| Platform sync lag | WARN | 17% stale; consider 2nd worker if sustained |
| Outage window documented | PASS | ~42h Jun 10 01:18 → Jun 11 21:15 UTC |
| Scaling post-deploy | WARN | Manual `scale:prod` required after CDK |

## Scaling recommendation (preliminary)

- **Current:** 1 inbox-checker task adequate for June Training mailboxes (all syncing).
- **Scale to 2 tasks if:** stale >10% sustained for 24h OR full cycle consistently >45 min with growing mailbox count.
- **Not needed for** June Training reply gap investigation — outage was total downtime, not polling delay.
