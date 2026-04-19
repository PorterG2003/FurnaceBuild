# Export cost allocation

V1 export allocation is derived from canonical direct `cost_records`.

## Export grains in scope

- owner exports
- contact exports built on owner export rows
- chain exports

## Allocation rule

1. Record direct cost once at the natural source-row grain.
2. Keep owner-specific direct enrichment on the owner row.
3. Evenly distribute company-level direct costs across export rows in scope unless a richer documented rule exists.

## Current direct inputs

### Owner-level enrichment

- source: `contact_enrichment_attempts.cost_record_id`
- allocation: none
- export effect: contributes directly to `enrichment_cost_cents`

### Company-level enrichment

- sources:
  - `company_website_verifications.cost_record_id`
  - `company_google_ads_verifications.cost_record_id`
- allocation: evenly across export rows for the company
- export effect:
  - `company_enrichment_cost_cents`
  - `enrichment_cost_per_row_cents`

### Company-level acquisition

- sources:
  - import run direct costs, allocated back down through current linked `source_business_records`
  - direct registry snapshot acquisition costs linked to a company
- allocation: evenly across export rows for the company
- export effect:
  - `company_acquisition_cost_cents`
  - `acquisition_cost_per_row_cents`

## Canonical view

`export_row_cost_summary` is the shared owner-grain cost view used by:

- owner export surfaces
- owner+contact export surfaces
- chain export cost merging

The view now emits exact fractional-cent values derived from `cost_records.cost_amount_micros`. It does not round company-level runtime or acquisition costs down to whole cents before export.

## Why allocations stay derived in v1

- no invalidation/rebuild job is required when export membership changes
- ledger stays focused on direct cost ownership
- lower-grain rollups remain explainable from a small number of SQL joins

If allocation ever becomes a performance bottleneck or needs export-specific persistence, child `cost_records` can be added later with `parent_cost_record_id`.
