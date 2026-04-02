# Reconciliation tables

Tables: **`company_entity_matches`**, **`company_entity_match_history`**, **`reconciliation_runs`**, **`reconciliation_results`**

Source migrations: [`20260322120000_init_registry_schema.sql`](../../../../supabase-leads/supabase/migrations/20260322120000_init_registry_schema.sql), [`20260323141000_company_entity_matches_registry_state.sql`](../../../../supabase-leads/supabase/migrations/20260323141000_company_entity_matches_registry_state.sql), [`20260324100000_registry_views_checks_grants.sql`](../../../../supabase-leads/supabase/migrations/20260324100000_registry_views_checks_grants.sql)

## Purpose

**Matching layer 2:** associate **`companies`** with **`state_entities`**, log automation runs, and record per-company outcomes.

## Why this matching layer exists

Registry entities and canonical companies evolve independently. You need explicit match rows with scores, statuses, and versioned matcher metadata—plus **run logs** for “what the job did yesterday.”

## Meaning of candidate / promoted / rejected

- **`candidate`:** possible match under review or scoring.
- **`promoted`:** chosen registry entity for this company **in a given state** (subject to uniqueness rule below).
- **`rejected`:** ruled out; retained for audit.

CHECK: `match_status IN ('candidate', 'promoted', 'rejected')`.

## Why `registry_state` is denormalized

`company_entity_matches.registry_state` copies **`state_entities.state`** via trigger **`trg_company_entity_matches_registry_state`** so the database can enforce:

**`uniq_current_promoted_match_per_company_state`:** partial unique on `(company_id, registry_state)` where `is_current = true AND match_status = 'promoted'`.

Without this column, enforcing “one promoted match per company per state” would require index expressions joining `state_entities` on every row mutation.

## One promoted current match per company per state

The partial unique index above guarantees at most **one** winning promoted row per company per `registry_state` among **current** rows. Non-current rows and candidates/rejects are unconstrained by this index.

## Run / result logging model

- **`reconciliation_runs`:** one row per job execution (`status`: `running`, `completed`, `failed`; version fields; `meta` JSON).
- **`reconciliation_results`:** many rows per run: `outcome` in `matched`, `no_match`, `ambiguous`, `error`; optional `company_entity_match_id`, `company_id`; `details` JSON.

## Common workflows

1. Start run: insert `reconciliation_runs` with `status = running`.
2. For each company, evaluate entities; insert/update `company_entity_matches` (`candidate` → `promoted` / `rejected`).
3. Append `reconciliation_results` per outcome.
4. Complete run: set `completed_at`, `status = completed`.

## Example row

`company_entity_matches`: `(company_id=C, state_entity_id=E, match_status=promoted, is_current=true, registry_state='DE', matcher_version='m1', …)` — trigger ensures `registry_state` matches `E.state`.

## Gotchas

- Trigger raises if `state_entity_id` points at a missing `state_entities` row.
- Updating a match archives **old** row to **`company_entity_match_history`**; ensure archive function includes `registry_state` (see migration `20260323141000_*`).

## Related

- [canonical-company.md](canonical-company.md), [registry-and-entities.md](registry-and-entities.md)
- [../views-and-triggers.md](../views-and-triggers.md) — `current_company_entity_matches` view
