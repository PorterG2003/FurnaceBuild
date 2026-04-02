# Status vocabularies

Central reference for **workflow string literals** in the registry database. Application code should mirror these exactly.

**TypeScript source:** [`lib/foundry/registry-types.ts`](../../../lib/foundry/registry-types.ts)

**Database CHECK constraints:** [`20260324100000_registry_views_checks_grants.sql`](../../../supabase-leads/supabase/migrations/20260324100000_registry_views_checks_grants.sql) (plus `company_entity_matches_status_check` and `reconciliation_runs_status_check` in [`20260322120000_init_registry_schema.sql`](../../../supabase-leads/supabase/migrations/20260322120000_init_registry_schema.sql)); `foundry_jobs` job_type/status in [`20260326120000_foundry_jobs.sql`](../../../supabase-leads/supabase/migrations/20260326120000_foundry_jobs.sql)

## `source_business_company_links.link_status`

`candidate` | `linked` | `rejected`

TS: `SOURCE_BUSINESS_LINK_STATUSES`

## `company_entity_matches.match_status`

`candidate` | `promoted` | `rejected`

TS: `COMPANY_ENTITY_MATCH_STATUSES`

## `reconciliation_results.outcome`

`matched` | `no_match` | `ambiguous` | `error`

TS: `RECONCILIATION_OUTCOMES`

## `review_tasks.status`

`pending` | `in_progress` | `resolved` | `cancelled`

TS: `REVIEW_TASK_STATUSES` in [`lib/foundry/registry-types.ts`](../../../lib/foundry/registry-types.ts)

## `review_tasks.task_type`

`source_link_review` | `company_dedupe` | `entity_match_review` | `parse_failure`

TS: `REVIEW_TASK_TYPES`

## `review_tasks.entity_type`

`source_business_record` | `company` | `company_entity_match` | `source_business_company_link`

## `ingestion_runs.status`

`running` | `completed` | `failed` | `cancelled`

## `reconciliation_runs.status`

`running` | `completed` | `failed`

## `foundry_jobs.status`

`queued` | `running` | `completed` | `failed` | `cancelled`

TS: `FOUNDRY_JOB_STATUSES` in [`lib/foundry/registry-types.ts`](../../../lib/foundry/registry-types.ts)

## `foundry_jobs.job_type`

`normalize_ingestion_run` | `bulk_source_resolution` | `state_matching_batch`

TS: `FOUNDRY_JOB_TYPES`

## Drift process

When changing allowed values:

1. Add or alter **CHECK** constraint in a new `supabase-leads` migration.
2. Update **`lib/foundry/registry-types.ts`** (and any UI enums).
3. Update this document.

## Related

- [../schema/indexes-and-constraints.md](../schema/indexes-and-constraints.md)
