# Registry API (Foundry Lambda)

Base URL: `custom.foundryRegistryApiUrl` in `amplify_outputs.json` (Function URL).  
Auth: `Authorization: Bearer <main Supabase access token>`; requires `user_access_flags.foundry`.

## Import

- `POST /imports/google-maps` — body: import name, column map, rows (see types in `lib/foundry/registry-types.ts`).

## Ingestion / source rows

- `GET /ingestion-runs`, `GET /ingestion-runs/:id`, `GET /ingestion-runs/:id/records`
- `POST /ingestion-runs/:id/normalize-records` — body `{ limit?: number }`; fills `source_business_records.resolution_meta` (synchronous; small batches)
- `POST /ingestion-runs/:id/jobs/normalize` — body `{ batchSize?: number }` (default 500, max 2000); creates **`foundry_jobs`**, starts the **normalize** Step Functions workflow deployed with Amplify; returns `{ jobId, executionArn, reused? }`. Returns **503** if the backend did not wire the state machine (deploy/synth failure).
- `GET /source-records/:id` — detail + current links + company snippets

## Async jobs

- `GET /jobs?status=&limit=` — list **`foundry_jobs`** (newest first)
- `GET /jobs/:id` — job row for polling (`status`, `progress`, `step_function_execution_arn`, etc.)

## Layer 1 — source resolution

- `POST /source-records/:id/candidates/generate`
- `POST /source-records/:id/link` — body `{ companyId }` or `{ createNew: true }`
- `POST /source-records/:id/reject-candidates`
- `POST /resolution/bulk` — body `{ sourceBusinessRecordIds: string[], maxRecords?: number }`

## Companies

- `GET /companies`, `POST /companies` (create), `GET /companies/:id`, `PATCH /companies/:id`, `POST /companies/:id/locations`

## Review

- `GET /review-tasks?status=&limit=`
- `GET /review-tasks/:id`
- `PATCH /review-tasks/:id/assign` — body `{ assigned_to }`
- `POST /review-tasks/:id/resolve` — body `{ resolution?, chosen_company_id?, chosen_match_action? }`
- `POST /review-tasks/:id/cancel`

## State matching (mock runner)

- `POST /state-matching/preflight` — body `{ companyIds: string[] }`
- `POST /state-matching/batches` — body `{ companyIds: string[] }` (max 50)
- `GET /state-matching/batches/:id` — `reconciliation_runs` + `reconciliation_results`

## Reconciliation

- `GET /reconciliation/runs/:id` — same payload as state batch detail (run + results)

## Related

- [services-and-jobs.md](services-and-jobs.md)
- [status-vocabularies.md](status-vocabularies.md)
