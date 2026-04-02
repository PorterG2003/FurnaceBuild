# Entity owners tables

Tables: **`entity_owners`**, **`entity_owner_history`**

Source migrations: [`20260322120000_init_registry_schema.sql`](../../../../supabase-leads/supabase/migrations/20260322120000_init_registry_schema.sql), [`20260323144000_company_locations_entity_owners_enrichment.sql`](../../../../supabase-leads/supabase/migrations/20260323144000_company_locations_entity_owners_enrichment.sql)

## Purpose

Capture **officers / owners** parsed from registry context and tie them to a **`state_entity`**, not directly to a canonical company.

## What owner rows represent

Each **`entity_owners`** row is typically one named role line from a registry parse: display `owner_name`, optional `title_role`, optional effective dates (`effective_at`, `ended_at`), `observed_at`, and `is_current` for append-and-close lifecycles.

## Why owners are tied to state entities

Owners are **evidence about a registry entity**. Canonical company identity is established separately; reconciliation links company ↔ entity. If owners linked only to `companies`, you would lose traceability when matches change.

## Why owner normalization fields exist

Optional columns: `owner_normalized_key`, `first_name`, `last_name`, `parse_confidence`, `parse_quality` — support deduplication, search, and quality metrics **before** a dedicated **`people`** (or officers) table exists.

## Current limitations (no `people` table yet)

The same human may appear on multiple entities or companies with different strings. There is **no** global person id; normalization keys are hints only.

## History behavior

`BEFORE UPDATE` archives prior row to **`entity_owner_history`**. Prefer **append + close** for owner changes (`new row is_current=true`, old row `is_current=false`) when modeling registry revisions; updates still archive.

## Important fields

- `state_entity_id` NOT NULL — anchor.
- `source_snapshot_id` optional — which pull the parse came from.

## Example workflow

Parse lists “Jane Doe, Manager” for entity `E`:

1. Insert `entity_owners` row with `owner_name`, `title_role`, `is_current=true`.
2. Registry amendment removes Jane; insert new row or set `ended_at` / `is_current=false` per product rules.

## Gotchas

- **`current_entity_owners`** is a view over `is_current = true` — keep `is_current` coherent when appending rows.
- History trigger snapshots must include new columns when you add them (see enrichment migration for pattern).

## Related

- [registry-and-entities.md](registry-and-entities.md)
- [../views-and-triggers.md](../views-and-triggers.md)
- [../../engineering/future-evolution.md](../../engineering/future-evolution.md)
