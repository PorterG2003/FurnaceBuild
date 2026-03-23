# Workflow: Reconcile company to state entity

## Goal

For each canonical **`company`** (often scoped by state), find the best **`state_entity`**, record **`company_entity_matches`**, and log outcomes in **`reconciliation_runs`** / **`reconciliation_results`**.

## Trigger / starting point

Scheduled reconciliation job, operator action, or post-registry-parse hook.

## Steps

1. **Start run** — Insert **`reconciliation_runs`** with `status = 'running'`, version fields (`matcher_version`, `scoring_version`, `ruleset_version`), optional `meta`.
2. **Candidate entity generation** — Load companies and candidate `state_entities` (registry id, name similarity, address keys, prior matches).
3. **Scoring** — Compute `match_score`; insert **`company_entity_matches`** as `candidate` with `is_current = true` as appropriate.
4. **Promotion / rejection** — Choose best candidate: set row to `promoted` (and ensure **`registry_state`** is set—DB trigger fills from `state_entities.state`). Mark losers `rejected` or `is_current = false` per rules.
5. **Per-state uniqueness** — Only **one** current `promoted` row per `(company_id, registry_state)` — enforced by **`uniq_current_promoted_match_per_company_state`**. Transactional promotion avoids races.
6. **Manual review path** — If top scores tie or below threshold, create **`review_tasks`** (`entity_match_review`) instead of promoting.
7. **Logging** — Insert **`reconciliation_results`** per company with `outcome` (`matched`, `no_match`, `ambiguous`, `error`) and `details` JSON. Mark run `completed` or `failed`.

## Tables touched

- **`reconciliation_runs`**, **`reconciliation_results`**
- **`company_entity_matches`**, **`company_entity_match_history`**
- **`companies`**, **`state_entities`** (read)
- **`review_tasks`** (optional)

Triggers: `trg_company_entity_matches_registry_state`, `trg_company_entity_matches_updated_at`, history archive.

## Success outcome

Promoted matches reflect operator/automation intent; run row `completed` with results for each processed company.

## Failure cases

- Unique index violation on promote — two workers racing; retry with lock or single-threaded partition.
- Trigger error if `state_entity_id` invalid — data integrity bug upstream.

## Review path

**`entity_match_review`** tasks carrying candidate entity ids and scores.

## Audit trail

**`company_entity_match_history`**, **`reconciliation_results`**, and run `meta`.

## Related

- [state-entity-matching.md](state-entity-matching.md) — batch / UI orchestration (preflight, automatic state dispatch, one state per company per v1 run)
- [../schema/tables/reconciliation.md](../schema/tables/reconciliation.md)
