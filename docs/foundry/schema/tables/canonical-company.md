# Canonical company tables

Tables: **`companies`**, **`company_locations`**, **`company_history`**, **`company_location_history`**

Source migrations: [`20260322120000_init_registry_schema.sql`](../../../../supabase-leads/supabase/migrations/20260322120000_init_registry_schema.sql), [`20260323140000_companies_drop_normalized_key_unique.sql`](../../../../supabase-leads/supabase/migrations/20260323140000_companies_drop_normalized_key_unique.sql), [`20260323144000_company_locations_entity_owners_enrichment.sql`](../../../../supabase-leads/supabase/migrations/20260323144000_company_locations_entity_owners_enrichment.sql)

## Purpose

Represent **your** canonical business and its **locations**, independent of any single external listing or registry row.

## What a canonical company represents

A **`companies`** row is the internal anchor for deduplication, UI, and reconciliation. Multiple source rows and multiple registry entities may point at one company over time via link and match tables.

## What a company location represents

A **`company_locations`** row is an address (or place) associated with a company: mailing, HQ, parsed listing address, etc. `is_primary` flags a default among siblings.

## Why `normalized_key` is indexed, not unique

Originally a UNIQUE constraint existed on `companies.normalized_key`; it was **dropped** so collisions can exist until clustering/dedupe improves. A **partial index** `idx_companies_normalized_key` remains for lookup performance (`WHERE normalized_key IS NOT NULL`). See migration `20260323140000_*`.

## History behavior

`BEFORE UPDATE` triggers on **`companies`** and **`company_locations`** insert the **previous** row into **`company_history`** / **`company_location_history`** as JSONB (`snapshot`), with monotonic `version_number` per entity.

`changed_by` and `change_reason` exist for operator attribution (UUID references main-app user without FK).

## Important fields (locations enrichment)

`company_locations` may include: `normalized_address_key`, `latitude` / `longitude`, `source_type`, `address_confidence`, `deliverability_status`, `address_hash` — supporting reconciliation and deliverability workflows without collapsing them into `companies`.

## Common read/write patterns

- **Create company** when source resolution or review decides no existing row fits.
- **Update company** legal name or notes when adjudication merges duplicates (history captures prior state).
- **Attach locations** as new rows; use `is_primary` carefully (application-level invariant for “single primary” is not always DB-enforced).

## Example lifecycle

1. Linker creates `companies` row `C` for a new business.
2. Ingest adds `company_locations` `L` with address from listing.
3. Reconciliation enriches `L` with `normalized_address_key` and geocode.
4. Name correction updates `C`; `company_history` stores prior JSON.

## Gotchas

- Deleting a company **cascades** to locations, links, and matches — destructive; prefer soft workflows where possible.
- History triggers snapshot a fixed set of columns; if you add columns, update trigger bodies (see enrichment migration for pattern).

## Related

- [source-resolution.md](source-resolution.md), [reconciliation.md](reconciliation.md)
- [../views-and-triggers.md](../views-and-triggers.md)
