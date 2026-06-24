# CSV Lead Import — Smoke Test Fixtures

Sample files for manually testing the builder CSV upload dedupe wizard.

**Location:** `fixtures/csv-import-smoke/`

All emails use the domain `@csv-smoke.furnace.test` so they won’t collide with real leads.

---

## Prerequisites

1. Open the **campaign builder** for a campaign that has a **Lead Source** node (CSV upload).
2. Know your account **block list** path (Settings → Block list, or wherever you manage blocked emails/domains).

---

## Test 1 — Basics (sync path, ≤500 rows)

**File:** `smoke-test-dedupe-basics.csv` (12 rows → **7 kept** after dedupe)

### Setup (optional, for block-list checks)

Before importing, add to your account block list:

| Type   | Value                      |
|--------|----------------------------|
| Email  | `blocked@csv-smoke.furnace.test` |
| Domain | `other-smoke.furnace.test` |

### Steps

1. Open Lead Source → **Upload CSV** → choose `smoke-test-dedupe-basics.csv`.
2. **Map Fields** — map `Email`, `First Name`, `Last Name`, `Company`; optionally map `Title` / `Notes` as custom fields.
3. **Dedupe** — block list ON by default; campaign dedupe OFF by default. With block list entries from setup, confirm preview metrics roughly match:
   - **2** removed as within-file duplicates (`alice`, `bob`)
   - **2** removed on block list (`blocked@…`, `frank@other-smoke…`)
   - **2** removed as invalid / no email
   - **7** ready to import
4. **Review** — confirm lead count and field mapping, then import.
5. **Import** — expect success with ~7 created leads.
6. Open **Lead Insights** and confirm the 7 emails appear (no duplicate `alice` or `bob` rows).

### Turn off filters (sanity check)

Re-upload the same file with **block list OFF** and **campaign dedupe OFF** — you should see more rows in Review (still 2 within-file dupes removed).

---

## Test 2 — Campaign overlap (cross-campaign dedupe)

**Files:** `smoke-test-campaign-seed.csv` then `smoke-test-campaign-overlap.csv`

### Steps

**Part A — Seed the campaign**

1. Upload `smoke-test-campaign-seed.csv` to the **same target campaign**.
2. Map fields, import all **3** leads (campaign dedupe can stay OFF).

**Part B — Overlap import**

1. Upload `smoke-test-campaign-overlap.csv` (5 rows).
2. On **Dedupe**, turn **Remove leads already in campaigns** ON, tap **Choose campaigns…**, and select the **target campaign**.
3. Expect **3** removed (already in campaign), **2** kept (`new-diana`, `new-edward`).
4. Import — only 2 new leads should be created; seed rows should not duplicate.

**Part C — Re-import safety (upsert)**

1. Import `smoke-test-campaign-overlap.csv` again with campaign dedupe OFF.
2. Sync import should **update** existing rows (not create duplicates). Check Insights — still 5 total leads in bucket (3 seed + 2 new), not 10.

---

## Test 3 — Async path (>500 rows)

**File:** `smoke-test-async-501-rows.csv` (501 rows)

### Steps

1. Upload the file to a campaign (fresh bucket or after clearing test leads).
2. Map `Email` + name fields.
3. **Import** — during upload, keep the tab open until the green callout says you can leave.
   - **Uploading** (yellow callout) — progress while rows stream to staging; don’t close the tab.
   - **Importing** (green callout) — after finalize, safe to close; worker runs in background.
4. When complete, Lead Insights should show **501** new leads (minus any you filtered).
5. Try closing the modal during **uploading** — you should get a confirm dialog.

---

## Quick reference — expected counts

| File | Input rows | Kept (all dedupe ON) | Import path |
|------|------------|----------------------|-------------|
| `smoke-test-dedupe-basics.csv` | 12 | 7 | Sync |
| `smoke-test-campaign-seed.csv` | 3 | 3 | Sync |
| `smoke-test-campaign-overlap.csv` | 5 | 2 (after seed) | Sync |
| `smoke-test-async-501-rows.csv` | 501 | 501 | Async staged |

---

## Cleanup

Delete test leads from the campaign in Lead Insights, or remove block-list entries you added for Test 1.

If an async upload was abandoned mid-upload, the job may sit in `uploading` — re-import the file after the migration is applied on your Supabase project.
