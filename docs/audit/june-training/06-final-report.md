# June Training Reply Detection — Final Audit Report

**Campaign:** June Training (`3d6a8efa-c7b0-42e0-8550-56865ef4da9e`)  
**Audit date:** 2026-06-11  
**Artifacts:** [`docs/audit/june-training/`](./)

---

## Executive answer

> **Do we know we are missing them?**

**No — not in meaningful numbers.** A full read-only IMAP scan of all **64 campaign mailboxes** (since 2026-06-09) found **`missed_matchable: 0`**: zero inbound messages with threading headers that match a June Training `provider_message_id` but are absent from Furnace.

The headline **0.45% reply rate** (15 / 3,340) is misleading because:
1. **All 15 detected replies are from the Jun 9 send cohort** (3.12% native rate).
2. **Jun 10–11 bulk cohort (2,846 enrollments) has 0 detected replies** — but IMAP ground truth shows **no hidden matchable reply pool** waiting to be ingested.
3. Historical Smartlead campaigns (~5%) are **not comparable** (imported stats, lifetime window, different counting).

The inbox-checker outage **did** cause delayed ingestion for **2 provably late replies** (Alexa, Clint on one mailbox). Recovery re-scan did **not** surface dozens of additional matchable replies.

---

## Summary table

| Metric | Jun 9 cohort | Jun 10–11 cohort | IMAP ground truth |
|--------|-------------:|-----------------:|------------------:|
| Enrollments sent | 481 | 2,846 | — |
| Furnace detected replies | 15 | 0 | — |
| Native reply % | **3.12%** | **0.00%** | — |
| IMAP matchable missed | — | — | **0** |
| IMAP ingested (matchable) | — | — | 16 |
| Headerless Re: (unmatchable) | — | — | 0 |

---

## Findings by hypothesis

| # | Hypothesis | Verdict | Evidence |
|---|------------|---------|----------|
| 1 | Outage gap (many missed replies) | **REJECTED** (at scale) | IMAP `missed_matchable: 0`; 2 late ingests only |
| 2 | Headerless replies | **NOT OBSERVED** | 0 `headerless_reply_like` in IMAP scan |
| 3 | Matching / provider_message_id failure | **REJECTED** | 0 null IDs; 0 missed_matchable; header linking PASS |
| 4 | List quality / cohort difference | **LIKELY** | Jun 10–11 0% vs Jun 9 3.12%; no IMAP counter-evidence |
| 5 | Operational drag (polling lag) | **MINOR** | June Training 64/64 synced; platform 17% stale |

---

## Phase deliverables

| Phase | Doc | Key result |
|-------|-----|------------|
| 0 | [00-charter.md](./00-charter.md) | Scope and thresholds |
| 1 | [01-db-reconciliation.md](./01-db-reconciliation.md) | Stats consistent; cohort split |
| 2 | [02-ops-health.md](./02-ops-health.md) | Checker recovered; scale:prod runbook |
| 3 | [03-imap-results.json](./03-imap-results.json) | **0 missed_matchable** |
| 4 | [04-matching-audit.md](./04-matching-audit.md) | Matching logic validated |
| 5 | [05-pipeline-audit.md](./05-pipeline-audit.md) | 15/15 categorized + completed |

---

## Recommendations (ranked)

### 1. Do NOT run `last_synced_at` backfill — **NO-GO**

Threshold for backfill was ≥20 `missed_matchable`. **Observed: 0.**

Resetting 64 mailboxes would re-process ~2,500+ warmup/noise messages with no expected yield.

### 2. Monitor Jun 10–11 cohort for late replies (48–72h) — **LOW PRIORITY**

Human replies can arrive days later. Re-run audit script weekly or watch `campaign_stats.replied_count` for Jun 10–11 enrollment cohort. No action needed now.

### 3. Operational hygiene — **DO**

- Run `npm run scale:prod` after every CDK deploy (workers default to desired=0).
- Consider **2 inbox-checker tasks** if platform stale mailboxes stay >10% (currently ~17% platform-wide, 0% on June Training mailboxes).

### 4. Stakeholder benchmark framing — **COMMUNICATE**

| Campaign | Source | Reply % | Furnace sends |
|----------|--------|--------:|--------------:|
| Jan Training Link | smartlead | 5.94% | 0 |
| Clinical Mental Health | smartlead | 5.34% | 0 |
| **June Training** | **native** | **0.45%** (headline) | 3,351 |
| **June Training Jun 9 only** | **native** | **3.12%** | 481 |

Fair internal comparison: **Jun 9 native cohort ~3%**, not Smartlead lifetime ~5%.

### 5. Product backlog (only if headerless gap appears elsewhere) — **NOT NEEDED HERE**

No `headerless_reply_like` messages found in this audit window.

---

## Decision tree outcome

```
Phase 3 complete → missed_matchable = 0
  → NO backfill
  → headerless = 0 → NOT a product gap for this campaign/window
  → Focus: list quality / offer for Jun 10–11 bulk cohort OR wait for late replies
```

---

## Tools added

- [`scripts/audit-june-training-replies.ts`](../../scripts/audit-june-training-replies.ts) — reusable campaign IMAP vs DB audit
- `npm run audit:june-training-replies` — see [`package.json`](../../package.json)

Example:

```bash
SELF_RECOVERY_TARGET_ENV=prod npm run audit:june-training-replies -- \
  --campaign-id 3d6a8efa-c7b0-42e0-8550-56865ef4da9e \
  --since 2026-06-09 \
  --output docs/audit/june-training/03-imap-results.json
```

---

## Audit sign-off

| Question | Answer |
|----------|--------|
| Are stats internally consistent? | Yes |
| Was inbox-checker down during bulk send? | Yes (~42h) |
| Did we miss dozens of matchable replies in IMAP? | **No (0)** |
| Should we backfill `last_synced_at`? | **No** |
| Is Jun 9 native rate healthy? | Yes (~3.12%) |
| Why is headline rate ~0.45%? | Jun 10–11 bulk with 0 replies so far + Smartlead benchmark mismatch |
