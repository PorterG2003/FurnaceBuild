# Review queue (`review_tasks`)

Table: **`review_tasks`**

Source migrations: [`20260323143000_review_tasks.sql`](../../../../supabase-leads/supabase/migrations/20260323143000_review_tasks.sql), CHECK additions in [`20260324100000_registry_views_checks_grants.sql`](../../../../supabase-leads/supabase/migrations/20260324100000_registry_views_checks_grants.sql), [`20260328120000_review_tasks_entity_owner_dedupe.sql`](../../../../supabase-leads/supabase/migrations/20260328120000_review_tasks_entity_owner_dedupe.sql), [`20260403140000_contact_enrichment_ambiguity_system.sql`](../../../../supabase-leads/supabase/migrations/20260403140000_contact_enrichment_ambiguity_system.sql)

## Purpose

Single **human-in-the-loop** queue for ambiguous automation: source linking, dedupe, entity matching, parse failures.

## Why review tasks exist

Some decisions are **unsafe to automate** at current confidence, but you still want **one place** for operators to work. `review_tasks` decouples “something is wrong” from specific UI pages—`task_type` and `payload` carry context.

## Allowed task types

CHECK constraint: `task_type IN (`

- `source_link_review`
- `company_dedupe`
- `entity_owner_dedupe`
- `entity_match_review`
- `parse_failure`
- `contact_enrichment_review`

`)`

## Allowed statuses

CHECK: `status IN ('pending', 'in_progress', 'resolved', 'cancelled')`.

## Polymorphic `entity_type` / `entity_id`

`entity_type` CHECK allows:

- `source_business_record`
- `company`
- `entity_owner`
- `company_entity_match`
- `source_business_company_link`
- `contact_enrichment_attempt` (`entity_id` = `contact_enrichment_attempts.id`)

`entity_id` is a UUID pointing at that table’s primary key. **No database FK** — integrity is **application-enforced**, trading strict referential guarantees for flexibility and simplicity.

## Tradeoffs of app-enforced integrity

- **Pros:** Easy to add new entity types; no migration churn on FK graphs; fast to ship new task kinds.
- **Cons:** Orphan `entity_id` possible if rows are deleted without canceling tasks; apps must validate on create and resolve.

## Expected operational usage

- Index **`idx_review_tasks_queue`:** `(status, priority DESC, created_at)` for pulling next work.
- Index **`idx_review_tasks_assignee`:** partial on `assigned_to` for “my queue.”
- `payload` / `resolution` JSON hold structured context and outcome; keep schemas documented in app code or here as they stabilize.

## Example lifecycle

1. Matcher finds two equal-score companies for one registry entity → insert task `entity_match_review`, `entity_type=company_entity_match`, `entity_id=<match uuid>`, `payload` with scores.
2. Operator sets `status=in_progress`, then `resolved` with `resolution` JSON and `resolved_at`.

## Gotchas

- `assigned_to` is UUID (main app user) with **no FK**.
- When deleting domain rows, cancel or resolve related tasks to avoid dead queue items.

## Related

- [../../workflows/review-and-adjudication.md](../../workflows/review-and-adjudication.md)
- [../../engineering/status-vocabularies.md](../../engineering/status-vocabularies.md)
