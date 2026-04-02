# Workflow: Registry lookup and parse

## Goal

Fetch registry evidence for a lookup key, store an immutable **`registry_source_snapshot`**, and derive **`state_entities`** and **`entity_owners`**.

## Trigger / starting point

Reconciliation needs fresh registry data, or operator triggers lookup from UI / job queue.

## Steps

1. **Trigger lookup** — Call external registry API or scrape with `(source_type, state, lookup_key)`.
2. **Store snapshot** — Insert **`registry_source_snapshots`** with `request_payload`, `response_payload`, `parser_version`, `parsed_successfully` default false until parse succeeds.
3. **Parse entities** — Parser reads snapshot; insert **`state_entities`** with `source_snapshot_id`, `state`, `registry_entity_id`, `legal_name`, `entity_status`, `raw_parsed`, `parser_version`. Set `parsed_successfully = true` on snapshot when done.
4. **Parse owners** — Insert **`entity_owners`** rows tied to `state_entity_id` and optionally `source_snapshot_id`.
5. **Failure / retry** — On parse failure: leave `parsed_successfully = false`, log error in worker, optionally create **`review_tasks`** (`parse_failure`). Retry may create a **new** snapshot row (preferred) or fix parser version and re-run against same snapshot in controlled tooling.

## Tables touched

- **`registry_source_snapshots`** (insert; avoid routine updates)
- **`state_entities`**, **`state_entity_history`**
- **`entity_owners`**, **`entity_owner_history`**
- **`review_tasks`** (optional)

## Success outcome

Snapshot row exists with accurate payloads; entities and owners created or updated with coherent `parser_version`.

## Failure cases

- Network / HTTP errors: no snapshot or snapshot with error encoded in `response_payload` — operator retries lookup.
- Parser exceptions: `parsed_successfully` false; **`review_tasks`** for human follow-up.

## Review path

**`parse_failure`** tasks reference a relevant `entity_type` (e.g. `source_business_record` or future snapshot id if you extend `entity_type`).

## Audit trail

Immutable snapshots; **`state_entity_history`** / **`entity_owner_history`** on updates.

## Related

- [state-entity-matching.md](state-entity-matching.md) — state-specific runners invoke this lookup-and-parse pattern inside batch matching
- [../schema/tables/registry-and-entities.md](../schema/tables/registry-and-entities.md)
- [../schema/tables/owners.md](../schema/tables/owners.md)
