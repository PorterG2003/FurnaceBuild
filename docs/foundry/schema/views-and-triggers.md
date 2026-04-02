# Views and triggers

## `current_company_entity_matches`

**Definition:** `SELECT * FROM company_entity_matches WHERE is_current = true`

**Purpose:** Convenient read surface for “active” reconciliation rows without repeating filter logic in every query.

**Security:** Recreated with **`WITH (security_invoker = true)`** so PostgREST callers using anon/authenticated roles inherit underlying table RLS ([`20260322180000_registry_views_security_invoker.sql`](../../../supabase-leads/supabase/migrations/20260322180000_registry_views_security_invoker.sql), refreshed in [`20260324100000_registry_views_checks_grants.sql`](../../../supabase-leads/supabase/migrations/20260324100000_registry_views_checks_grants.sql)). Default views behave like definer-style and can bypass RLS—this avoids that footgun.

## `current_entity_owners`

**Definition:** `SELECT * FROM entity_owners WHERE is_current = true`

**Purpose:** Current officer/owner lines for an entity when using append-and-close updates.

**Security:** Same `security_invoker = true` pattern as above.

## `company_contact_projection`

**Definition:** One row per `companies.id`, derived from canonical `company_locations` with fallback to current linked `source_business_records`.

**Purpose:** Reusable company-scoped contact read model for export-safe address and website fields.

**Behavior:**
- Prefers the primary/current `company_locations` row for structured address fields.
- Falls back to linked `source_business_records` fields when canonical address fields are missing.
- Uses `address_raw` only as a last-resort `address_line_1`, with a best-effort US-style parse into city/state/postal when structured source fields are absent.
- Picks one best current linked website per company.

## `export_company_targets`

**Definition:** One row per current promoted `company_entity_match`, joined to `company_contact_projection`.

**Purpose:** Common company-level export target surface shared by owner export and chain export.

**Behavior:**
- Carries company identity, promoted match identity, export flags, and company-scoped contact fields.
- Separates export target/readiness semantics from owner expansion.

## `export_company_owner_leads`

**Definition:** `export_company_targets` left-joined to current `entity_owners`.

**Purpose:** Owner-row export surface; preserves one null-owner row when a company target has no current owners.

## `updated_at` trigger

**Function:** `registry_update_updated_at_column()` — sets `NEW.updated_at = now()` before update.

**Tables:** `companies`, `company_locations`, `state_entities`, `entity_owners`, `company_entity_matches`, `ingestion_runs`, `source_business_records`, `source_business_company_links` (each has `trg_*_updated_at`).

## History archive triggers

**Pattern:** `BEFORE UPDATE` on live table → insert **prior** row JSON into `*_history` with next `version_number`.

**Tables with archive triggers:** `companies`, `company_locations`, `state_entities`, `entity_owners`, `company_entity_matches`, `source_business_company_links`.

**Note:** When adding columns to a live table, update the corresponding archive function to include new fields in `jsonb_build_object` (see [`20260323144000_company_locations_entity_owners_enrichment.sql`](../../../supabase-leads/supabase/migrations/20260323144000_company_locations_entity_owners_enrichment.sql)).

## `registry_state` trigger

**Name:** `trg_company_entity_matches_registry_state`  
**Function:** `trg_company_entity_matches_set_registry_state()`  
**When:** `BEFORE INSERT OR UPDATE` on **`company_entity_matches`**

**Behavior:** Loads `state_entities.state` for `NEW.state_entity_id`; sets `NEW.registry_state`; raises if entity missing.

**Rationale:** Supports partial unique index **`uniq_current_promoted_match_per_company_state`** without a join expression in the index.

## Design rationale (summary)

| Mechanism | Why |
|-----------|-----|
| `security_invoker` views | Prevent accidental RLS bypass via views |
| `BEFORE UPDATE` history | Cheap audit of mutable business rows |
| `registry_state` trigger | Enforce per-state promoted uniqueness cheaply |
| No snapshot trigger | Snapshots are evidence; append-only |

## Related

- [indexes-and-constraints.md](indexes-and-constraints.md)
- [tables/reconciliation.md](tables/reconciliation.md)
