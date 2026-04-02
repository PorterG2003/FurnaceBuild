# Core concepts

Shared vocabulary for Foundry. Table and column truth lives in `supabase-leads/supabase/migrations/`; this page is the narrative glossary.

## Ingestion run

A row in **`ingestion_runs`**: one logical import or pull from a named source (`source_name`, `source_type`). Tracks `status` (`running`, `completed`, `failed`, `cancelled`), timing, `config` / `stats`, and optional `ingest_version` / `parser_version`. Raw rows belong to exactly one run via **`source_business_records.ingestion_run_id`**.

## Source business record

A row in **`source_business_records`**: one business as seen by a source (name, address fields, `raw_payload`, optional `source_record_id`). This is **not** a canonical company; it is evidence from a single ingestion run. **`resolution_meta`** (JSONB) stores derived matching keys and quality flags; **`raw_payload`** stays the immutable CSV snapshot for that row.

## Canonical company

A row in **`companies`**: your internal record for a real-world business (`legal_name`, optional `normalized_key`, `notes`). **`company_locations`** holds addresses and enrichment fields tied to `company_id`. Canonical data can evolve; updates archive to **`company_history`** / **`company_location_history`**.

## Source-to-company link

A row in **`source_business_company_links`**: associates one **`source_business_record`** with one **`company`**. Carries `link_status` (`candidate`, `linked`, `rejected`), optional `link_score`, `linker_version`, and `is_current`. This is **matching layer 1** (raw → canonical). Updates archive to **`source_business_company_link_history`**.

## Registry source snapshot

A row in **`registry_source_snapshots`**: **immutable** evidence of one registry pull (`source_type`, `state`, `lookup_key`, request/response JSON, `parser_version`, `parsed_successfully`). Parsed structures are derived into **`state_entities`** (and owners), not merged into `companies` automatically.

## State entity

A row in **`state_entities`**: one legal entity (or equivalent) as parsed from registry data, tied optionally to **`registry_source_snapshots`**, with `state`, `registry_entity_id`, `legal_name`, `entity_status`, `raw_parsed`, `parser_version`. This is **registry truth**, not canonical company truth. Updates archive to **`state_entity_history`**.

## Company-to-state-entity match

A row in **`company_entity_matches`**: associates one **`company`** with one **`state_entity`**. Carries `match_status` (`candidate`, `promoted`, `rejected`), scores, matcher/scoring/ruleset versions, `is_current`, and denormalized **`registry_state`** (maintained by trigger from `state_entities.state`). This is **matching layer 2** (canonical → registry). Updates archive to **`company_entity_match_history`**.

## Reconciliation run / result

- **`reconciliation_runs`**: one execution of a matcher over some scope (`status`: `running`, `completed`, `failed`; version fields; `meta`).
- **`reconciliation_results`**: per-company (or per-match) outcomes for that run: `outcome` (`matched`, `no_match`, `ambiguous`, `error`), optional links to `company_entity_match_id` / `company_id`, and `details` JSON.

## Entity owner

A row in **`entity_owners`**: an officer/owner line parsed from registry context, tied to **`state_entity_id`** (and optionally **`source_snapshot_id`**). Supports `is_current` for append-and-close patterns; optional normalized name fields prepare for a future **people** table. Updates archive to **`entity_owner_history`**.

## Review task

A row in **`review_tasks`**: human work item (`task_type`, `status`, priority, assignee). Targets a row identified by polymorphic **`entity_type`** + **`entity_id`** (e.g. `source_business_company_link`, `company_entity_match`). Payload and resolution are JSON for flexibility.

## History table / current view

- **History:** Tables named `*_history` store versioned **snapshots** of prior row state (triggered on `BEFORE UPDATE` for linked mutable tables). Used for audit and debugging.
- **Current views:** **`current_entity_owners`** and **`current_company_entity_matches`** filter `is_current = true` on the underlying tables (see [../schema/views-and-triggers.md](../schema/views-and-triggers.md)).

## Related

- [entity-resolution-operator-guide.md](entity-resolution-operator-guide.md) — operator-facing layer-1 / layer-2 flow
- [../architecture/data-model.md](../architecture/data-model.md) — how these concepts sit in layers
- [../engineering/status-vocabularies.md](../engineering/status-vocabularies.md) — allowed enum-like strings
