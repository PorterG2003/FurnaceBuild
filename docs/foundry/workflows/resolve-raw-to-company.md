# Workflow: Resolve raw to company

## Goal

Turn each **`source_business_record`** into zero or one **current `linked`** **`source_business_company_links`** row pointing at the correct **`companies`** row (creating the company when needed).

## Trigger / starting point

Ingest completed, or operator requests re-linking for a record.

## Steps

1. **Candidate generation** — For record `R`, search `companies` (e.g. by `normalized_key`, name similarity, address keys). Insert **`source_business_company_links`** with `link_status = 'candidate'`, `is_current = true`, `linker_version`.
2. **Review** — If ambiguous, create **`review_tasks`** (`source_link_review` or `company_dedupe`) referencing `source_business_record` or `source_business_company_link`.
3. **Link finalization** — Pick winner: insert or update link row to `link_status = 'linked'`. Ensure no other current `linked` row exists for `R` (DB enforces via **`uniq_source_business_one_linked_current`**).
4. **Creating new companies** — If no candidate fits, insert **`companies`** (+ optional **`company_locations`**), then link with `linked`.
5. **Updating current links** — When changing mind, set old link `is_current = false` or move to `rejected`; add new row or update with history archiving on UPDATE.

## Tables touched

- **`source_business_records`** (read)
- **`companies`**, **`company_locations`** (insert/update)
- **`source_business_company_links`**, **`source_business_company_link_history`**
- **`review_tasks`** (optional)

## Success outcome

Exactly **one** current `linked` row for the source record (or intentional zero if business rejected at product level—then use `rejected` links, not `linked`).

## Failure cases

- Unique index violation when two `linked` current rows compete — serialize promotions in code or use transactions.
- Orphan company after bad merge — use review and history to roll back.

## Review path

Primary path for ambiguity: **`review_tasks`** with payload carrying candidate ids and scores.

## Audit trail

**`source_business_company_link_history`** stores prior link rows on UPDATE; company changes archive to **`company_history`**.

## Related

- [../schema/tables/source-resolution.md](../schema/tables/source-resolution.md)
