# Raw ingestion tables

Tables: **`ingestion_runs`**, **`source_business_records`**

Source migration: [`20260323142000_ingestion_and_source_tables.sql`](../../../../supabase-leads/supabase/migrations/20260323142000_ingestion_and_source_tables.sql)

## Purpose

Record **batches** of inbound business data and preserve each **raw row** as observed, before canonical resolution.

## Why these tables exist

Downstream matching (`source_business_company_links`) needs stable pointers to “what the file/API said.” Without batching, you cannot attribute failures, reprocess a single import, or explain stats to operators.

## `ingestion_runs`

### Table responsibilities

- One row per **import job** or logical pull.
- Tracks lifecycle: `status` in `running`, `completed`, `failed`, `cancelled`.
- Holds opaque `config` and `stats` JSON for operator visibility.

### Important fields

- `source_name`, `source_type` — identify the pipeline.
- `ingest_version`, `parser_version` — correlate code behavior with rows.
- `error_summary` — human-readable failure summary when `status = failed`.
- `cost_record_id`, `cost_status` — canonical direct-cost pointer + cost lifecycle marker.
- legacy compatibility fields remain during migration: `cost_per_row_cents`, `total_cost_cents`, `cost_rate_card_id`, `cost_is_override`.

### Constraints and rules

- `ingestion_runs_status_check` on `status`.

### Lifecycle / common operations

1. Insert run with `status = running`.
2. Insert many `source_business_records` with `ingestion_run_id`.
3. Finalize the run and, when priced, write one canonical direct row in `cost_records`.
4. Update `stats`, `completed_at`, `status`, `cost_record_id`, and `cost_status`.

### Example workflow

A CSV upload creates run `R`, streams 10k rows into `source_business_records`, then marks `R` completed with `stats` `{ "rows": 10000, "valid": 9980 }`.

### Gotchas

- Deleting a run **cascades** to its `source_business_records` (`ON DELETE CASCADE`).

## `source_business_records`

### Table responsibilities

- One row per **business observation** from a source within a run.
- Stores both normalized columns (`name_raw`, address fields) and full **`raw_payload`**.

### Important fields

- `source_record_id` — optional stable id from the source (indexed when present).
- `categories`, lat/lng, structured address fields — optional enrichment from the ingest parser.

### Constraints and rules

- `name_raw` NOT NULL (minimum viable identity for a row).

### Lifecycle / common operations

- Insert during ingest; updates bump `updated_at` via trigger (e.g. late correction pass).

### Gotchas

- This row is **not** a company; never assume global uniqueness without application logic.

## Related

- [source-resolution.md](source-resolution.md) — links from records to `companies`
- [../views-and-triggers.md](../views-and-triggers.md) — `updated_at` triggers
- [../../engineering/cost-records.md](../../engineering/cost-records.md)
