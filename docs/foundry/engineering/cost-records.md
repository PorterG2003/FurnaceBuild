# Unified cost records

Foundry now records direct cost at the natural grain of the work in canonical `cost_records`, then links the owning source row back to that ledger row with `cost_record_id`.

## Goals

- One mental model for imports, Skip Sherpa, runtime-estimated workers, and future sources.
- Explicit distinction between:
  - `costed`
  - `failed_or_not_costed`
  - `pre_cost_implementation_or_not_backfilled`
- Predictable export allocation from direct costs down to owner, contact, and chain rows.
- Preserve raw usage on source rows when it helps debugging (`elapsed_ms` for runtime workers).

## Canonical shape

Every direct row in `cost_records` carries:

- pricing identity: `cost_kind`, `provider`, `product`
- usage: `usage_quantity`, `usage_unit`
- money: `cost_amount_micros`, generated `cost_amount_cents`, `currency`
- provenance: `source_entity_type`, `source_entity_id`
- reporting helpers: `company_id`, `ingestion_run_id`, `foundry_job_id`, `reconciliation_run_id`
- lineage hooks for future materialized allocations: `record_kind`, `parent_cost_record_id`, `allocation_method`

`cost_amount_micros` is the canonical stored amount because runtime work often costs less than one cent per direct event. `cost_amount_cents` is generated for compatibility and display.

## Source ownership rule

Store the direct cost where the work actually happened:

- imports: `ingestion_runs`
- Skip Sherpa: `contact_enrichment_attempts`
- website verification: `company_website_verifications`
- website intelligence LLM calls: `company_website_intelligence`
- Google Ads verification: `company_google_ads_verifications`
- state registry pulls: `registry_source_snapshots`

One owning source row gets at most one direct ledger row.

## Rate-card convention

`cost_rate_cards` remains the pricing source of truth, but cards now also declare:

- `usage_unit`
- `unit_quantity`

That lets runtime cards express prices like “5 cents per 3,600,000 ms” instead of forcing fake per-ms integer cents.

Current runtime naming convention:

- provider: `furnace_runtime`
- enrichment products:
  - `website_verification_ms`
  - `google_ads_verification_ms`
- acquisition products:
  - `utah_registry_pull_ms`
  - `florida_registry_pull_ms`

## Zero vs missing

- Evaluated events that truly cost zero still get a direct `cost_records` row.
- Failed or otherwise not-costed events keep `cost_record_id = null` and set `cost_status = 'failed_or_not_costed'`.
- Historical rows we could not safely backfill keep `cost_status = 'pre_cost_implementation_or_not_backfilled'`.

## Export allocation

V1 keeps direct costs materialized and lower-grain allocation derived in SQL.

- owner-level direct enrichment stays on the owner row
- company-level enrichment is allocated evenly across export rows in scope
- acquisition costs are allocated evenly across export rows in scope

`export_row_cost_summary` is the canonical export rollup surface built on `cost_records`.

## Main implementation files

- migration foundation: `supabase-leads/supabase/migrations/20260417110000_unified_cost_records_ledger.sql`
- export allocation view: `supabase-leads/supabase/migrations/20260417123000_export_row_cost_summary_from_cost_records.sql`
- shared pricing + ledger helpers: `lib/foundry/registry-server/costRateCards.ts`

## Related docs

- [Cost migration runbook](./cost-records-migration-runbook.md)
- [Export cost allocation](./export-cost-allocation.md)
- [Schema overview](../schema/schema-overview.md)
