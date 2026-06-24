# Bucket insights smoke seed

Predictable **2,500 leads** in one campaign for smoke-testing the builder **Lead Bucket** modal (server pagination + column fill headers).

**Campaign name:** `Bucket Insights Smoke (2500 leads)`  
**Default campaign id:** `f0000000-0000-4000-8000-00000000b001`  
**Emails:** `bucket-smoke-00000@bucket-smoke.furnace.test` … `bucket-smoke-02499@bucket-smoke.furnace.test`

---

## Run the seed

Requires service role credentials (see [`scripts/seed/README.md`](../../scripts/seed/README.md)).

```bash
export SEED_ACCOUNT_ID='<your-account-uuid>'
export SEED_OWNER_USER_ID='<your-user-uuid>'

npx tsx scripts/seed/index.ts --scenario=bucket-insights-smoke --dry-run
npx tsx scripts/seed/index.ts --scenario=bucket-insights-smoke
```

Optional: `SEED_CAMPAIGN_ID` to pin a different campaign UUID (re-runs delete and recreate leads for that campaign only).

---

## Expected column fill rates (2,500 leads)

Pattern is deterministic by lead index `i` (0-based).

| Column / field | Rule | Filled | Empty |
|----------------|------|--------|-------|
| `email` | always | 2,500 | 0 |
| `first_name` | always | 2,500 | 0 |
| `last_name` | `i % 5 !== 0` | 2,000 | 500 |
| `company_name` | `i % 5 < 3` | 1,500 | 1,000 |
| `website` | `i % 5 < 2` | 1,000 | 1,500 |
| `linkedin_url` | `i % 5 === 0` | 500 | 2,000 |
| `territory` (custom) | `i % 2 === 0` | 1,250 | 1,250 |
| `tier` (custom) | `i % 10 === 0` | 250 | 2,250 |

---

## Manual smoke checklist

1. Open **Campaigns** → **Bucket Insights Smoke (2500 leads)** → **Flow editor**.
2. Click the **Lead Bucket** node.
3. Confirm header shows **2,500 leads in bucket**.
4. Confirm column header bars match the table above (requires `bucket_lead_field_coverage` migration).
5. Paginate through **126 pages** (20 per page) — e.g. page 1 vs page 50 vs page 126 show different emails.
6. Optional: import more leads via CSV wizard and confirm count + pagination update.

---

## Cleanup

Re-running the scenario deletes all leads for the seeded campaign id and imports fresh rows. To remove the campaign entirely, delete it in the app or via SQL after wiping leads.
