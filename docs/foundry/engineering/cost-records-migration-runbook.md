# Cost records migration runbook

This rollout moves Foundry from source-table-specific cost fields to canonical `cost_records`.

## What shipped

- `cost_records` ledger table
- `cost_record_id` links on direct-cost source tables
- `cost_status` markers on those same source tables
- runtime `elapsed_ms` persistence on runtime-owned source rows
- export cost views rebuilt on `cost_records`

## Backfill scope

Backfill is intentionally conservative.

Included:

- import acquisition rows where legacy run cost data was already present
- contact enrichment attempts where the attempt was evaluable from stored data
- Google Ads verification rows where historical `lookup_stats.elapsed_ms` exists

Not automatically backfilled:

- website verification rows without persisted elapsed timing
- registry snapshots created before elapsed timing existed
- any row where enough source data was not present to reconstruct a defensible direct cost

Those rows remain `pre_cost_implementation_or_not_backfilled`.

## Operational sequence

1. Apply DB migrations.
2. Deploy API + worker code that writes `cost_records`.
3. Verify new direct rows are being linked on:
   - `ingestion_runs`
   - `contact_enrichment_attempts`
   - `company_website_verifications`
   - `company_google_ads_verifications`
   - `registry_source_snapshots`
4. Spot-check export totals from `export_row_cost_summary`.
5. Prepare a cleanup report before removing legacy compatibility fields.

## Project commands

Use project scripts where they exist:

1. From `infra/workers`: `npm run apply:migrations`
2. From `infra/workers`: build/push the changed worker images with the appropriate `npm run build:*` script
3. From `infra/workers`: restart workers with the appropriate `npm run restart:*` script
4. Verify with `npm run check:services` and `npm run check:logs`

## Validation queries

Use checks like these during rollout:

- imports: compare historical `ingestion_runs.total_cost_cents` totals against summed import `cost_records`
- Skip Sherpa: compare historical `contact_enrichment_attempts.cost_amount_cents` totals against linked direct ledger rows
- exports: compare current export totals before/after the migration on a fixed company sample
- status audit:
  - `cost_record_id IS NOT NULL` should imply `cost_status = 'costed'`
  - failed runtime rows should have `cost_record_id IS NULL` and `cost_status = 'failed_or_not_costed'`

## Cleanup gate

Do not remove legacy source-table compatibility fields until:

1. intended backfill is complete
2. direct write paths have been exercised in production-like runs
3. export totals are validated
4. a cleanup report is ready
5. explicit approval is given

## Notes for future sources

When adding a new costed workflow:

1. choose the durable owning source row
2. add `cost_record_id` and `cost_status`
3. persist raw usage if useful
4. write one direct ledger row per source row
5. document how export allocation should treat that direct cost
