# Wave 1 status

## Group B — DONE
- 25 queued, 2 skipped (`tay.hull37` known registrant, `kdelamare5` first_name `W`)
- `sendlog_B.csv`

## Pending automated Link cancel (S6) — DONE 2026-08-05
- Dry-run `cancel-pending-link-for-wave1-b.ts` against prod for sendlog_B_final
  threads: **0** pending Link/`campaign_priority` jobs (queued/pending/deferred/held).
- Nothing to cancel — manual Wave1 B replies already covered the double-send risk.

## Group A — DONE (user authorized without fresh registrant export)
- Re-diff: always-suppress only (0 dropped; alt emails not in A)
- Dry-run: 326/326
- Live: **326 queued** via `POST /v1/threads/{id}/reply` (no send-now)
- `sendlog_A.csv` / `sendlog_A_final.csv`
- Temp API key created for the run and **revoked** after

## Wave 2
`wave2_hold_recent.csv` untouched.
