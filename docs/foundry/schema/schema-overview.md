# Schema overview

## Schema philosophy

Foundry’s registry database optimizes for **provenance**, **safe concurrency**, and **auditable automation**:

- **Separate** raw, canonical, registry, and match tables so each invariant has a clear home.
- **Immutable** registry snapshots plus **history** for mutable business rows.
- **Constraints** (CHECK + partial UNIQUE) encode workflow rules the app must not be allowed to violate accidentally.
- **Server-only** access pattern: RLS on, no anon/authenticated policies; service role for backends ([SUPABASE_LEADS.md](../../infrastructure/SUPABASE_LEADS.md)).

Migrations live in [`supabase-leads/supabase/migrations/`](../../../supabase-leads/supabase/migrations/).

## Main table groups

| Group | Tables |
|-------|--------|
| Raw ingest | `ingestion_runs`, `source_business_records` |
| Canonical | `companies`, `company_locations` |
| Source resolution | `source_business_company_links`, `source_business_company_link_history` |
| Registry | `registry_source_snapshots`, `state_entities`, `state_entity_history` |
| Reconciliation | `company_entity_matches`, `company_entity_match_history`, `reconciliation_runs`, `reconciliation_results` |
| Owners | `entity_owners`, `entity_owner_history` |
| Review | `review_tasks` |
| Canonical audit | `company_history`, `company_location_history` |

## Current / live tables vs history tables

- **Live:** Rows in the primary tables are the **current** truth (`companies`, `source_business_company_links`, `company_entity_matches`, etc.). Some tables also use **`is_current`** on the live row (`entity_owners`, `company_entity_matches`, links) to support soft supersession without deleting history.
- **History:** `*_history` tables store **previous** versions when a live row is **updated** (`BEFORE UPDATE` trigger archives `OLD` as JSONB). They do not replace live rows.
- **Views:** `current_entity_owners`, `current_company_entity_matches` filter `is_current = true` (see [views-and-triggers.md](views-and-triggers.md)).

`registry_source_snapshots` has **no** update archive trigger by design: treat rows as **append-only** evidence.

## Key relationships

- `source_business_records.ingestion_run_id` → `ingestion_runs`
- `source_business_company_links` → `source_business_records`, `companies`
- `state_entities.source_snapshot_id` → `registry_source_snapshots` (nullable)
- `entity_owners.state_entity_id` → `state_entities`
- `company_entity_matches` → `companies`, `state_entities`
- `reconciliation_results.reconciliation_run_id` → `reconciliation_runs`

## Important uniqueness rules

- **`uniq_source_business_one_linked_current`:** at most one row per `source_business_record_id` where `is_current = true` and `link_status = 'linked'`.
- **`uniq_source_business_company_links_current_pair`:** at most one current row per `(source_business_record_id, company_id)` (prevents duplicate active pair rows).
- **`uniq_current_promoted_match_per_company_state`:** at most one current `promoted` match per `(company_id, registry_state)` on `company_entity_matches`.

## Important constraints

- **CHECK** constraints on `ingestion_runs.status`, `source_business_company_links.link_status`, `company_entity_matches.match_status`, `reconciliation_runs.status`, `reconciliation_results.outcome`, `review_tasks.status` / `task_type` / `entity_type`.
- **`registry_state`** on `company_entity_matches`: NOT NULL, set by trigger from `state_entities.state` so partial indexes and queries do not depend on joins.

## Denormalization: `registry_state`

`company_entity_matches.registry_state` duplicates `state_entities.state` so the database can enforce **one promoted match per company per state** with a simple partial unique index. A `BEFORE INSERT OR UPDATE` trigger sets `registry_state` from the linked `state_entities` row ([`20260323141000_company_entity_matches_registry_state.sql`](../../../supabase-leads/supabase/migrations/20260323141000_company_entity_matches_registry_state.sql)).

## Server-side access and security

- RLS **enabled** on all tables; **no** policies for `anon` / `authenticated` → default deny for JWT users hitting PostgREST.
- Migration **revokes** broad `GRANT`s on tables, sequences, and routines for `anon` / `authenticated`.
- **Service role** bypasses RLS for trusted backend use only.

Details: [../engineering/security-and-access.md](../engineering/security-and-access.md).

## Per-table documentation

- [tables/raw-ingestion.md](tables/raw-ingestion.md)
- [tables/canonical-company.md](tables/canonical-company.md)
- [tables/source-resolution.md](tables/source-resolution.md)
- [tables/registry-and-entities.md](tables/registry-and-entities.md)
- [tables/reconciliation.md](tables/reconciliation.md)
- [tables/owners.md](tables/owners.md)
- [tables/review-queue.md](tables/review-queue.md)
