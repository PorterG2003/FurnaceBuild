# Registry and entities tables

Tables: **`registry_source_snapshots`**, **`state_entities`**, **`state_entity_history`**

Source migrations: [`20260322120000_init_registry_schema.sql`](../../../../supabase-leads/supabase/migrations/20260322120000_init_registry_schema.sql)

## Purpose

Store **immutable evidence** of registry API/scrape responses and the **parsed registry entities** derived from that evidence.

## Why snapshots are immutable

`registry_source_snapshots` rows are **append-only by convention**: each pull gets a new row with `request_payload`, `response_payload`, `parser_version`, and `parsed_successfully`. That lets you re-run parsers against exact historical bytes, prove compliance, and debug “what the registry returned on Tuesday.”

There is no `BEFORE UPDATE` archive trigger on snapshots; treat updates as exceptional (e.g. admin repair only).

## How state entities are parsed from snapshots

Application or worker code reads a snapshot, parses structured fields, and inserts **`state_entities`** with optional **`source_snapshot_id`**, `state`, `registry_entity_id`, `legal_name`, `entity_status`, `raw_parsed`, `parser_version`.

## Why registry entities are separate from canonical companies

`state_entities` reflect **a jurisdiction’s record** at a point in time, including parser quirks. **`companies`** reflect **your** consolidated view. Linking them is **`company_entity_matches`** (layer 2), not a shared primary key.

## History behavior

Updates to **`state_entities`** archive the previous row to **`state_entity_history`** via `BEFORE UPDATE` trigger (`snapshot` JSONB).

## Important fields

**`registry_source_snapshots`**

- `source_type`, `state`, `lookup_key` — how you queried.
- `retrieved_at` — when evidence was obtained.
- `elapsed_ms` — persisted runtime usage when the pull was costed under the unified ledger.
- `cost_record_id`, `cost_status` — canonical direct-cost link + cost lifecycle marker for that immutable pull.

**`state_entities`**

- `registry_entity_id` — state’s identifier when available.
- `raw_parsed` — structured parse output for debugging and reprocessing.

## Example flow

1. Worker performs lookup `(state=DE, lookup_key=FILE123)`.
2. Insert snapshot `S` with full HTTP JSON in `response_payload`.
3. Parser v3 creates `state_entity` `E` with `source_snapshot_id = S`, `parser_version = '3'`.
4. If registry data is corrected later, **new** snapshot `S2` and optional new entity row or update `E` (update archives to history).

## Gotchas

- `source_snapshot_id` on `state_entities` is **nullable** — handle entities created from legacy imports.
- Deleting a snapshot may set FK to NULL (`ON DELETE SET NULL`) on `state_entities` / `entity_owners`; prefer never deleting snapshots in production.
- snapshot rows are append-only evidence, but they may now carry cost linkage metadata for the direct pull that created them.

## Related

- [reconciliation.md](reconciliation.md)
- [owners.md](owners.md)
- [../schema-overview.md](../schema-overview.md)
- [../../engineering/cost-records.md](../../engineering/cost-records.md)
