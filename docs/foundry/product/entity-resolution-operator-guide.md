# Entity resolution — operator guide

**Entity resolution** in Foundry is two matching layers plus human review:

1. **Layer 1 — Source → company:** `source_business_records` are linked to canonical `companies` via `source_business_company_links` (`candidate` → `linked` / `rejected`). At most **one** current `linked` row per source record.
2. **Layer 2 — Company → state entity:** `company_entity_matches` connect `companies` to `state_entities`, with outcomes logged in `reconciliation_runs` / `reconciliation_results`. At most **one** current `promoted` match per `(company_id, registry_state)`.
3. **Review:** `review_tasks` when automation is unsure (`source_link_review`, `entity_match_review`, etc.).

## Happy path

- Import CSV → rows appear under **Imports → records**.
- **Normalize keys (batch)** writes `resolution_meta` (name key, domain key, inferred US state).
- **Auto-resolve unresolved** or per-row actions create or link a **company** and set `link_status = linked`.
- **State matching (mock)** (until real connectors exist): preflight by company, then batch run creates mock registry evidence and reconciliation results.
- High-confidence layer-2 matches are **promoted**; ambiguous ones get **entity_match_review** tasks.

## Ambiguous path

- Mid-confidence layer-1 → **`source_link_review`** task; resolve by choosing a company UUID in the **Review** screen.
- Mid-confidence layer-2 → **`entity_match_review`**; **Promote** or **Reject** from the queue.

## Error path

- Import or API failures surface error messages on the client.
- `reconciliation_results.outcome = error` for per-company failures in a batch (inspect via API or future run detail UI).

## Related docs

- [../workflows/resolve-raw-to-company.md](../workflows/resolve-raw-to-company.md)
- [../workflows/state-entity-matching.md](../workflows/state-entity-matching.md)
- [../workflows/reconcile-company-to-state-entity.md](../workflows/reconcile-company-to-state-entity.md)
- [../workflows/review-and-adjudication.md](../workflows/review-and-adjudication.md)
