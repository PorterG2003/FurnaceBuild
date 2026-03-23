# Source resolution tables

Tables: **`source_business_company_links`**, **`source_business_company_link_history`**

Source migration: [`20260323142000_ingestion_and_source_tables.sql`](../../../../supabase-leads/supabase/migrations/20260323142000_ingestion_and_source_tables.sql), CHECK + partial index in [`20260324100000_registry_views_checks_grants.sql`](../../../../supabase-leads/supabase/migrations/20260324100000_registry_views_checks_grants.sql)

## Purpose

**Matching layer 1:** connect each **`source_business_record`** to a **`company`** with an explicit status and version metadata.

## Why this layer exists

Raw rows disagree; companies merge and split. You need a first-class table for “we think record R is company C with confidence/score S” that can be **re-adjudicated** without losing the old decision (history + `is_current`).

## Candidate vs linked vs rejected

- **`candidate`:** proposed association; multiple candidates per source record are allowed (different `company_id` rows can be current concurrently **only if** not both `linked`).
- **`linked`:** accepted association. **At most one** current `linked` row per `source_business_record_id` (`uniq_source_business_one_linked_current`).
- **`rejected`:** discarded hypothesis; kept for audit and to prevent re-proposing blindly.

CHECK: `link_status IN ('candidate', 'linked', 'rejected')`.

## Multiple candidates allowed

Several current rows per source record may exist with `link_status = 'candidate'` (and different `company_id`). Promotion to `linked` should clear or supersede competing candidates in application logic.

## Only one current linked row per source record

Partial unique index **`uniq_source_business_one_linked_current`** on `(source_business_record_id)` where `is_current = true AND link_status = 'linked'`.

## Pair uniqueness for current rows

**`uniq_source_business_company_links_current_pair`:** at most one current row per `(source_business_record_id, company_id)`.

## History behavior

`BEFORE UPDATE` on **`source_business_company_links`** archives **`OLD`** into **`source_business_company_link_history`** (`snapshot` JSONB, `version_number`).

## Example lifecycle

1. Ingest creates `source_business_record` `R`.
2. Linker inserts link row: `(R, C1, candidate, is_current=true)`.
3. Scoring improves; add `(R, C2, candidate, is_current=true)` — allowed.
4. Human picks `C2`; update first candidate to `rejected` or `is_current=false`, set `(R, C2, linked, is_current=true)`.
5. Later correction updates the linked row; history retains prior snapshot.

## Gotchas

- Violating **one linked** or **pair uniqueness** causes hard DB errors — surface as operator-visible failures in the app.
- `linker_version` is required on every row — always bump or set when changing linking logic.

## Related

- [raw-ingestion.md](raw-ingestion.md)
- [canonical-company.md](canonical-company.md)
- [review-queue.md](review-queue.md) — `source_link_review` tasks
