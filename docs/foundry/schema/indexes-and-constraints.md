# Indexes and constraints

This page indexes the **most workflow-critical** database rules. Full DDL is in [`supabase-leads/supabase/migrations/`](../../../supabase-leads/supabase/migrations/).

## Partial unique indexes

| Index | Table | Predicate | Intent |
|-------|-------|-----------|--------|
| `uniq_source_business_one_linked_current` | `source_business_company_links` | `is_current = true AND link_status = 'linked'` | At most **one** accepted company per source row |
| `uniq_source_business_company_links_current_pair` | `source_business_company_links` | `is_current = true` | At most **one** current row per `(source_business_record_id, company_id)` |
| `uniq_current_promoted_match_per_company_state` | `company_entity_matches` | `is_current = true AND match_status = 'promoted'` | At most **one** promoted registry match per company per `registry_state` |
| `uniq_cost_records_direct_source` | `cost_records` | `record_kind = 'direct'` | At most **one** canonical direct cost row per owning source row |

## Status and vocabulary CHECK constraints

| Table | Constraint | Allowed values |
|-------|------------|------------------|
| `ingestion_runs` | `ingestion_runs_status_check` | `running`, `completed`, `failed`, `cancelled` |
| `source_business_company_links` | `source_business_company_links_link_status_check` | `candidate`, `linked`, `rejected` |
| `company_entity_matches` | `company_entity_matches_status_check` | `candidate`, `promoted`, `rejected` |
| `reconciliation_runs` | `reconciliation_runs_status_check` | `running`, `completed`, `failed` |
| `reconciliation_results` | `reconciliation_results_outcome_check` | `matched`, `no_match`, `ambiguous`, `error` |
| `review_tasks` | `review_tasks_status_check` | `pending`, `in_progress`, `resolved`, `cancelled` |
| `review_tasks` | `review_tasks_task_type_check` | `source_link_review`, `company_dedupe`, `entity_match_review`, `parse_failure` |
| `review_tasks` | `review_tasks_entity_type_check` | `source_business_record`, `company`, `company_entity_match`, `source_business_company_link` |
| direct cost source tables | `*_cost_status_check` | `costed`, `failed_or_not_costed`, `pre_cost_implementation_or_not_backfilled` |
| `cost_records` | `cost_records_cost_kind_check` | `acquisition`, `enrichment` |
| `cost_records` | `cost_records_record_kind_check` | `direct`, `allocated` |

## Foreign keys

Standard CASCADE/SET NULL behavior applies—see migrations. Notable patterns:

- `source_business_records.ingestion_run_id` → `ingestion_runs` **ON DELETE CASCADE**
- `source_business_company_links` → records/companies **ON DELETE CASCADE**
- `state_entities.source_snapshot_id` → `registry_source_snapshots` **ON DELETE SET NULL**
- `reconciliation_results.reconciliation_run_id` → `reconciliation_runs` **ON DELETE CASCADE**

## Current / live row uniqueness rules (summary)

- **One linked per source record** (partial unique, above).
- **One promoted per (company, registry_state)** among current rows (partial unique, above).
- **`companies.normalized_key`:** not unique—only a partial btree index for lookups.

## Why these constraints protect workflow correctness

- **Source resolution** cannot accidentally finalize two different “winning” companies for the same raw row.
- **Reconciliation** cannot accidentally mark two different registry entities as the promoted truth for the same company in the same state.
- **CHECK** constraints keep analytics and UI from persisting unknown status strings that downstream jobs would misinterpret.

## Related

- [../engineering/status-vocabularies.md](../engineering/status-vocabularies.md)
- [views-and-triggers.md](views-and-triggers.md)
