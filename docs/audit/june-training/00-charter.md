# June Training Reply Detection Audit — Charter

**Date:** 2026-06-11  
**Campaign:** June Training (`3d6a8efa-c7b0-42e0-8550-56865ef4da9e`)  
**Prod DB:** Supabase `lrfonoslwzodzijzdyiy`  
**Primary question:** Are we missing dozens of matchable replies (outage / ingestion gap), or is the low rate mostly real (list quality / headerless replies / Smartlead comparison mismatch)?

## Scope

| Dimension | Value |
|-----------|-------|
| Mailboxes | 64 via `campaign_mailboxes` |
| Send window | 2026-06-09 through 2026-06-11 (UTC) |
| Inbox-checker outage | ~2026-06-10 01:18 UTC → ~2026-06-11 21:15 UTC |

## Cohorts (do not blend)

| Cohort | Expected behavior |
|--------|-------------------|
| Jun 9 sends | Inbox checker healthy; ~3% native Furnace baseline |
| Jun 10–11 sends | Bulk send during outage; 0 detected replies is suspicious |
| Smartlead historical | Benchmark only; not apples-to-apples with native detection |

## Hypotheses (ranked)

1. **Outage gap** — replies in IMAP during downtime, recovery captured only a handful
2. **Headerless replies** — human replies without `In-Reply-To`/`References` (never counted)
3. **Matching failure** — headers present but `provider_message_id` mismatch
4. **List quality** — genuinely low reply rate
5. **Operational drag** — IMAP auth errors, polling lag (secondary)

## Success criteria

| Outcome | Threshold | Action |
|---------|-----------|--------|
| `missed_matchable` ≥ 20 | Strong outage gap | Reset `last_synced_at` on 64 mailboxes to 2026-06-09 |
| `missed_matchable` 2–10 | Small gap | Optional targeted backfill |
| `missed_matchable` 0–1 | Low rate likely real | Focus on list/offer; no backfill |
| `unmatchable_no_headers` large | Product gap | Track headerless-reply heuristic separately |

## Artifact locations

| Phase | Path |
|-------|------|
| Charter | `docs/audit/june-training/00-charter.md` |
| DB reconciliation | `docs/audit/june-training/01-db-reconciliation.md` |
| Ops health | `docs/audit/june-training/02-ops-health.md` |
| IMAP script | `scripts/audit-june-training-replies.ts` |
| IMAP results | `docs/audit/june-training/03-imap-results.json` |
| IMAP summary CSV | `docs/audit/june-training/03-imap-summary.csv` |
| Matching audit | `docs/audit/june-training/04-matching-audit.md` |
| Pipeline audit | `docs/audit/june-training/05-pipeline-audit.md` |
| Final report | `docs/audit/june-training/06-final-report.md` |

## Constraints

- No blind `last_synced_at` backfill until Phase 3 IMAP ground truth completes
- IMAP audit is read-only (no DB writes from script)
- Do not edit the plan file
