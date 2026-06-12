# Smartlead migration fix — handoff

Handoff for the Foot Traffic Co prod migration bugs (June 2026) and the code fixes shipped to prevent recurrence. Use this doc to continue deploy, re-import, and verification in a new conversation.

---

## Context

**Account:** Foot Traffic Co — `account_id: 40a23e97-8fa7-4668-bbd5-287f50fa2745`

**Original prod migration run:** `2ba35bc6-75bd-47ae-b5a6-7e393c84dca8`  
- Status: `completed_with_warnings` (5/6 campaigns succeeded, 1 failed)  
- Finished: 2026-06-10 ~00:35 UTC  
- ECS task: `760c27f4a0534d15a604e304ee895b5d`

**Symptom:** Furnace campaign list metrics did not match Smartlead UI after import.

---

## What broke (prod investigation)

### 1. Foot Traffic - Scraped Emails — all zeros

| | Smartlead | Furnace (before fix) |
|---|---|---|
| Sent | 1,063 | 0 |
| Replied | 12 | 0 |
| Positive | 1 | 0 |
| Bounced | 7 (+2 sender) | 0 |

**Cause:** Campaign failed during **leads** phase with:

```
Failed to upsert leads batch: ON CONFLICT DO UPDATE command cannot affect row a second time
```

Smartlead returned duplicate `smartlead_lead_id` values in a single 200-row upsert batch. The campaign shell was created first; ~1,000 leads imported across 5 batches; batch 6 failed; enrollments/conversations/stats never ran.

Migration row: `status: failed`, `furnace_campaign_id: null` (failure path doesn't backfill), but Furnace campaign `7b7a7e52-5faf-4ce4-9649-0dbdf32b2a52` exists from the campaign upsert step.

### 2. Foot Traffic - Apollo Contacts — replied & positive mismatch

| | Smartlead UI | Furnace (before fix) |
|---|---|---|
| Replied | 61 | 52 |
| Positive | 3 | 0 |

**Cause:** Two different Smartlead APIs:

- **Inbox-replies API** → 61 threads imported (matches Smartlead UI “Replied w/OOO”)
- **Analytics API** → `reply_count: 52`, `positive_reply_count: 0` → written to `campaign_stats` (what the campaigns list reads via `campaigns_list_summary`)

CloudWatch log from prod task:

```
repliedLeadsFromApi: 61
totalStats: { sent: 7937, replied: 52, bounce: 8 }
```

Positive reply: inbox items carry a `category` object, but migration did not parse it or set `email_threads.category`. All 61 threads had `category: null`.

### 3. Hidden: lead/enrollment integrity (multi-campaign accounts)

`leads.smartlead_lead_id` had a **global** unique constraint, but Furnace leads are **campaign-specific**. Later campaigns in the same migration run overwrote `leads.campaign_id` on conflict, leaving enrollments pointing at leads assigned to other campaigns.

**Foot Traffic - Scraped Emails 2:** 968 of 2,752 enrollments referenced leads whose `campaign_id` no longer matched the enrollment’s campaign.

### 4. What matched correctly (no action needed)

- Scraped Emails 2 (2,730 sent)
- Apollo Contacts (Lead Magnet) (3,220 sent)
- Podiatry (224 sent, 2 replied)
- Patient Care (462 sent, 2 replied, 3 bounced = Smartlead bounced + sender bounced)

---

## Code fixes (implemented)

**Commit:** `60d4fcb` — *Smartlead migration patches*

**Branch:** `foot-traffic-smartlead-recovery` (also contained in `main` history)

### Fix 1 — Batch dedupe

- `dedupeSmartleadLeadsById()` after fetch and per batch before upsert (last occurrence wins)
- Prevents Postgres “cannot affect row a second time” on duplicate IDs in one batch

### Fix 2 — Per-campaign lead identity

- **Migration:** `supabase/migrations/20260610120000_smartlead_lead_per_campaign_unique.sql`
  - Drops `leads_smartlead_lead_id_key`
  - Adds `UNIQUE (campaign_id, smartlead_lead_id)`
- **Code:** `upsertLeadsFromSmartlead` uses `onConflict: 'campaign_id,smartlead_lead_id'`

### Fix 3 — Stats reconciliation

- `finalizeImportedCampaignStats()` after stats import (runs even if day-by-day fetch fails)
- `replied_count` = `MAX(analytics, threads with has_reply)`
- `positive_reply_count` = `MAX(analytics, threads with category = 'Interested')`
- Sent/bounce still from analytics API

**Note:** Per-day charts (`imported_campaign_stats_by_day`) still come from analytics only; list totals are authoritative for Smartlead parity.

### Fix 4 — Positive reply / category import

- Parse `category` from inbox-replies payload
- `fetchSmartleadLeadCategories()` → `GET /leads/fetch-categories`
- `mapSmartleadCategoryToFurnace()` → `Interested` / `Not Interested` / `Neutral` on `email_threads.category`

### Fix 5 — Idempotent re-import (no repair script)

- `clearSmartleadCampaignImportArtifacts(campaignId)` at start of each `migrateSingleSmartleadCampaign` (after campaign upsert, before leads)
- Wipes: `email_messages`, `email_threads`, `enrollments`, `leads`, `imported_campaign_stats_by_day` for that campaign
- Keeps campaign shell + `smartlead_campaign_id`
- **Safe to re-run full migration from UI** for any account after deploy

---

## Key files

| File | Purpose |
|---|---|
| `lib/smartlead/migration.ts` | All import logic, wipe, dedupe, stats finalize, category mapping |
| `lib/smartlead/migration.test.ts` | Unit tests (10 tests; run with `node --import tsx --test lib/smartlead/migration.test.ts`) |
| `supabase/migrations/20260610120000_smartlead_lead_per_campaign_unique.sql` | DB constraint fix |
| `workers/smartlead-migration-task/src/index.ts` | ECS worker (calls `migrateSingleSmartleadCampaign`) |
| `docs/implementation/campaign-stats/CAMPAIGN_STATS_CALCULATIONS.md` | Smartlead import stats section |
| `docs/platform/smartlead-inbox-migration-handoff.md` | Separate doc: InboxAlways IMAP / inbox-checker reply matching |

---

## Deploy order

1. **Apply Supabase migration** — `20260610120000_smartlead_lead_per_campaign_unique.sql` on prod (and dev/staging first if not already)
2. **Deploy smartlead-migration-task worker** — prod ECS task must include commit `60d4fcb` or later
3. **Re-import via UI** for Foot Traffic Co and any other Smartlead-imported accounts

---

## Re-import procedure (all clients)

Do **not** use “Retry failed” alone — it only re-runs failed/cancelled campaigns.

1. Account → **Smartlead migration wizard**
2. Enter API key
3. **Select all Smartlead campaigns**
4. Run migration (~20–25 min per account, rate-limited API)

Each campaign is wiped and re-imported idempotently by the worker.

---

## Foot Traffic verification targets

Spot-check Furnace campaigns list vs Smartlead UI:

| Campaign | Sent | Replied | Positive |
|---|---:|---:|---:|
| Foot Traffic - Scraped Emails 2 | 2730 | 0 | 0 |
| Foot Traffic - Apollo Contacts (Lead Magnet) | 3220 | 0 | 0 |
| Foot Traffic - Scraped Emails | 1063 | 12 | 1 |
| Foot Traffic - Podiatry Contacts (ran ads) | 224 | 2 | 0 |
| Foot Traffic - Patient Care (Ran Ads) | 462 | 2 | 0 |
| Foot Traffic - Apollo Contacts | 7937 | **61** | **3** |

**Additional checks:**

- Scraped Emails 2: `enrollment count` = `lead count` (no orphaned enrollments)
- Apollo Contacts: 61 `email_threads` with `has_reply`, 3 with `category = 'Interested'`

### Useful prod queries (service role)

```sql
-- Migration run
SELECT * FROM smartlead_migration_runs
WHERE account_id = '40a23e97-8fa7-4668-bbd5-287f50fa2745'
ORDER BY created_at DESC LIMIT 1;

-- Per-campaign stats
SELECT c.name, cs.sent_count, cs.replied_count, cs.positive_reply_count, cs.bounce_count
FROM campaigns c
JOIN campaign_stats cs ON cs.campaign_id = c.id
WHERE c.account_id = '40a23e97-8fa7-4668-bbd5-287f50fa2745'
  AND c.source = 'smartlead'
ORDER BY c.created_at DESC;

-- Apollo thread counts
SELECT COUNT(*) FILTER (WHERE has_reply) AS reply_threads,
       COUNT(*) FILTER (WHERE category = 'Interested') AS interested
FROM email_threads
WHERE campaign_id = 'fe5f470d-c5ce-4475-8544-99e8180d4ea7';
```

**CloudWatch:** `/ecs/furnace/smartlead-migration-task-prod`

---

## Validation checklist

- [ ] Supabase migration applied on prod
- [ ] smartlead-migration-task worker deployed on prod
- [ ] Foot Traffic: full UI re-import (all 6 campaigns) completed
- [ ] All 6 campaigns match Smartlead screenshot
- [ ] Scraped Emails 2: enrollments align with leads
- [ ] Second Smartlead account re-imported successfully (optional safety pass)
- [ ] Unit tests pass: `node --import tsx --test lib/smartlead/migration.test.ts`

---

## Related work (same era, different scope)

These were in the same git timeframe but are **not** part of the migration stats fix:

- **Inbox-checker `isReply()` fix** — also checks `References` header (~0.9% of InboxAlways replies). See `docs/platform/smartlead-inbox-migration-handoff.md`. Needed for **live** reply detection after cutover, not for historical import stats.
- **150 InboxAlways mailboxes** — CSV import under Foot Traffic Co; separate from Smartlead campaign wizard.

---

## Git reference

| Item | Value |
|---|---|
| Feature branch | `foot-traffic-smartlead-recovery` |
| Migration fix commit | `60d4fcb` |
| Remote | `origin/foot-traffic-smartlead-recovery` |

To continue on the branch:

```bash
git checkout foot-traffic-smartlead-recovery
```

The migration fix commit is also an ancestor of current `main` if merging from there instead.
