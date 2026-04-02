# Workflow: Review and adjudication

## Goal

Humans resolve ambiguity that automation cannot safely finalize, updating links, matches, companies, or parse follow-ups with traceable outcomes.

## Trigger / starting point

Pipeline creates **`review_tasks`** (`status = 'pending'`), or operator opens review queue UI.

## Steps

1. **What creates review tasks** — Ingest (parse_failure), source linker (source_link_review), dedupe (company_dedupe), matcher (entity_match_review). Each row sets `task_type`, `entity_type`, `entity_id`, `payload`.
2. **Task assignment** — Optionally set `assigned_to` (main-app user UUID) and `status = 'in_progress'`.
3. **Reviewing source links** — Load `source_business_company_link` or related record by `entity_id`; compare candidates in `payload`; update link rows to `linked` / `rejected` / `is_current` per [resolve-raw-to-company.md](resolve-raw-to-company.md).
4. **Reviewing entity matches** — Load `company_entity_match`; promote/reject per [reconcile-company-to-state-entity.md](reconcile-company-to-state-entity.md); respect partial unique indexes inside a transaction.
5. **Resolving tasks** — Set `status = 'resolved'`, `resolved_at = now()`, fill `resolution` JSON (chosen ids, rationale codes).
6. **Canceling** — `status = 'cancelled'` when duplicate task or obsolete.

## Tables touched

- **`review_tasks`** (primary)
- **`source_business_company_links`**, **`companies`**, **`company_entity_matches`**, **`state_entities`**, **`entity_owners`** (depending on task type)

## Success outcome

Task `resolved` with coherent domain rows; no violating DB constraints.

## Failure cases

- Domain row deleted while task open — resolve as cancelled or fix application guards.
- Constraint violation on apply — resolution must be rolled back; task stays in progress.

## Audit trail

Domain tables’ **`_history`** tables capture updates; `review_tasks.resolution` captures human intent summary.

## Related

- [state-entity-matching.md](state-entity-matching.md) — ambiguous batch matching creates `entity_match_review` style follow-ups
- [../schema/tables/review-queue.md](../schema/tables/review-queue.md)
- [../engineering/status-vocabularies.md](../engineering/status-vocabularies.md)
