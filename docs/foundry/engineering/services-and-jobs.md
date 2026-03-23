# Foundry services and jobs (implementation map)

Server-side code for the registry API lives in [`amplify/functions/foundryRegistryApi/`](../../../amplify/functions/foundryRegistryApi/). Shared DB-heavy logic used by the API and CDK workers lives in [`lib/foundry/registry-server/`](../../../lib/foundry/registry-server/). The app calls the Function URL via [`lib/foundry/registry-client.ts`](../../../lib/foundry/registry-client.ts).

**Async orchestration** (Step Functions + worker Lambdas) is defined in [`infra/foundry/`](../../../infra/foundry/) — see [`../../infrastructure/FOUNDRY_ORCHESTRATION.md`](../../infrastructure/FOUNDRY_ORCHESTRATION.md).

## Modules (Amplify Lambda)

| File / area | Responsibility |
|-------------|----------------|
| `handler.ts` | Auth, routing, Google Maps import, list endpoints |
| `foundryJobsApi.ts` | `foundry_jobs` + `StartExecution` for normalize workflow |
| `validateImport.ts` | CSV row classification for import |
| `entityResolution.ts` | Layer 1: normalize run (re-exports shared normalize), candidates, link, reject, bulk auto-resolve |
| `foundryLayer2.ts` | Mock state runner, preflight, orchestrated batch, reconciliation scoring hooks, review resolution |
| `foundryApiRoutes.ts` | Extended HTTP routes (source records, companies, review, state matching) |

## Shared package (`@furnace/registry-server`)

| Area | Responsibility |
|------|----------------|
| `normalizeSourceRecord.ts` | Deterministic `resolution_meta` (name/domain/US state hint) |
| `normalizeIngestionRun.ts` | `normalizeIngestionRunRecords` (sync slice) + `normalizeIngestionRunRecordsChunk` (keyset pages for Step Functions) |

## Job types (`foundry_jobs.job_type`)

| `job_type` | Orchestrator | Status |
|------------|--------------|--------|
| `normalize_ingestion_run` | Step Functions `foundry-normalize-ingestion-*` + Lambda chunk worker | Implemented |
| `bulk_source_resolution` | Stub state machine only | Planned |
| `state_matching_batch` | Amplify Step Functions `foundry-state-matching-{env}` (mock Lambda + Utah ECS) | Implemented |

**Orchestration:** **Step Functions** is the primary coordinator for long runs; **SQS** is optional for buffering/fan-out later, not the main orchestration layer.

## Idempotency

- Normalization skips rows already at current `normalizer_version` with same `normalized_name_key`.
- Async normalize uses **`idempotency_key`** `normalize:{ingestion_run_id}:{normalizer_version}` with a **partial unique index** while `status ∈ (queued, running)`; duplicate starts return the existing job.
- State matching batch creates one `reconciliation_runs` row per synchronous invocation; future async state jobs will follow the same `foundry_jobs` pattern.

## Related

- [registry-api.md](registry-api.md) — HTTP surface
- [security-and-access.md](security-and-access.md)
- [FOUNDRY_ORCHESTRATION.md](../../infrastructure/FOUNDRY_ORCHESTRATION.md)
