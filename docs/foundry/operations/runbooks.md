# Runbooks

Operational recipes for Foundry / registry Supabase. CLI and linking: [SUPABASE_LEADS.md](../../infrastructure/SUPABASE_LEADS.md).

## Retry failed ingestion run

1. In SQL or admin UI, inspect **`ingestion_runs`** (`status = 'failed'`, `error_summary`).
2. Fix upstream cause (file format, API credentials).
3. Either insert a **new** run and re-import, or reset run to `running` and reprocess only if your pipeline idempotently skips duplicate `source_record_id` rows.
4. Mark run `completed` with updated `stats`.

**Tables:** `ingestion_runs`, `source_business_records`

## Retry failed registry parse

1. Find **`registry_source_snapshots`** with `parsed_successfully = false`.
2. Fix parser or data; re-run parser against **same** snapshot row (controlled tool) or insert a **new** snapshot if the registry response changed.
3. Update or insert **`state_entities`** / **`entity_owners`**; set `parsed_successfully = true` when correct.

## Resolve ambiguous source link

1. List **`source_business_company_links`** for `source_business_record_id` with `link_status = 'candidate'`.
2. Use **`review_tasks`** (`source_link_review`) payload if present.
3. Promote one link to `linked` inside a transaction; set others `rejected` or `is_current = false` so **`uniq_source_business_one_linked_current`** holds.

## Resolve ambiguous registry match

1. Inspect **`company_entity_matches`** for `company_id` with multiple `candidate` rows or low scores.
2. Open **`review_tasks`** (`entity_match_review`).
3. Set chosen row to `promoted`; others `rejected` or non-current; rely on **`uniq_current_promoted_match_per_company_state`**.

## Fix bad owner parse

1. Identify **`entity_owners`** rows (wrong `owner_name` / split names).
2. Prefer **append + close**: new row `is_current = true`, old `is_current = false`, or update row (triggers **`entity_owner_history`**).

## Inspect history

1. For a live id, query corresponding **`_history`** table ordered by `version_number DESC`.
2. `snapshot` JSONB is the prior row state.

## Debug constraint failures

| Error pattern | Likely cause | Direction |
|---------------|--------------|-----------|
| `uniq_source_business_one_linked_current` | Two `linked` current for one record | Transactional promotion; cancel duplicate |
| `uniq_current_promoted_match_per_company_state` | Two `promoted` current for same company/state | Demote or reject one |
| `trg_company_entity_matches_registry_state` | `state_entity_id` invalid | Fix FK target |

## Foundry Lambda timeouts or 502 on bulk actions

1. **Reduce batch size:** `POST /resolution/bulk` respects `maxRecords` (default 50, cap 100). `POST /state-matching/batches` allows at most 50 companies per call and runs **asynchronously** (poll `GET /jobs/:id`).
2. **Split by run:** Normalize with `POST /ingestion-runs/:id/normalize-records` and a lower `limit` if a single run has thousands of rows.
3. **Prefer async normalize:** `POST /ingestion-runs/:id/jobs/normalize` runs chunk loops in **Step Functions** ([FOUNDRY_ORCHESTRATION.md](../../infrastructure/FOUNDRY_ORCHESTRATION.md)); poll `GET /jobs/:id`.

## Deploy order (Amplify + optional Foundry CDK stubs)

1. Apply **`supabase-leads`** migrations (includes **`foundry_jobs`**).
2. Set Amplify secret **`LEADS_SUPABASE_SECRET_KEY`** and synth-time **`LEADS_SUPABASE_URL`** (see [SUPABASE_LEADS.md](../../infrastructure/SUPABASE_LEADS.md)).
3. Deploy **Amplify** — includes `foundryRegistryApi`, **`foundryNormalizeJob`**, the normalize Step Functions state machine, and IAM **`states:StartExecution`** on that machine.
4. **Optional:** `cdk deploy` **`infra/foundry`** for Phase 2–3 **stub** state machines only ([FOUNDRY_ORCHESTRATION.md](../../infrastructure/FOUNDRY_ORCHESTRATION.md)).

## Stuck `foundry_jobs` in `queued` or `running`

1. Compare **`step_function_execution_arn`** with Step Functions **Execution status** in AWS Console.
2. If the execution **failed** but the job row still shows `running`, set `status = 'failed'`, `completed_at = now()`, and **`error_summary`** from the execution history (or Step’s **Cause**).
3. If **no execution** exists (API failed after insert), mark the job failed or delete the row and retry **StartExecution** from the API after fixing IAM/ARN.
4. **Idempotency:** A new run for the same ingestion + normalizer version cannot start while another job is `queued`/`running` (unique partial index). After completion, a **new** normalize job is allowed.

## Stuck `reconciliation_runs` in `running`

1. Inspect row `meta` JSON for `run_kind: state_matching_orchestration` and error hints.
2. If the Lambda died mid-batch, set `status = 'failed'` and `completed_at = now()` manually or via admin SQL, then start a **new** run (do not assume partial results are complete).

## Related

- [../schema/indexes-and-constraints.md](../schema/indexes-and-constraints.md)
- [../workflows/review-and-adjudication.md](../workflows/review-and-adjudication.md)
- [../engineering/registry-api.md](../engineering/registry-api.md)
