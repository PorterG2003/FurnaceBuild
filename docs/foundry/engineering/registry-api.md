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

## Export

- `GET /export/company-owner-leads` — owner-row export; one row per current owner on an exportable company target, with company-scoped address and website fields attached. Query params: `limit`, `offset`, `q` (min 2 chars, `legal_name` ilike), `registry_state`, tri-state flags `is_export_ready`, `has_current_linked_source`, `has_open_review_task`, `has_parse_failure_task`, `has_current_owner` (same as before).
- `GET /export/company-chain-people` — chain export; pages by matching company targets, then expands each target through ownership chains to terminal people. Supports `max_depth`, `max_chains`, and the same filter params as owner export.

**Optional contact enrichment** (off by default; use `include_contact=true`):

- Adds columns from the **latest** promoted SkipSherpa match per `(company_id, entity_owner_id)` (view `export_owner_contact_enrichment_flat`): `contact_email_1`…`contact_email_3`; for each phone slot (1–3): number (`e164` then `local_format`), `contact_phone_n_type`, `contact_phone_n_is_dnc` (boolean or `null` when unknown / not provided — treat `null` separately from `false` for compliance), and `contact_phone_n_dnc_summary` (JSON text from provider, empty object omitted).
- `include_contact_confidence=true` (only with `include_contact`): `contact_confidence_tier` (`High` vs `Standard` — `High` when top matcher score ≥ 6 and either a single ranked candidate or margin vs runner-up ≥ 2), `contact_enrichment_top_score`, `contact_enrichment_score_margin`, `contact_enrichment_reason_summary` (comma-separated `ambiguity_reason_codes` from the attempt metadata, often empty for strong matches).

Chain export applies the same enrichment by merging flat rows onto each expanded person row (`person_owner_row_id` = `entity_owner_id` in enrichment tables).

## Review

- `GET /review-tasks?status=&limit=`
- `GET /review-tasks/:id`
- `PATCH /review-tasks/:id/assign` — body `{ assigned_to }`
- `POST /review-tasks/:id/resolve` — body `{ resolution?, chosen_company_id?, chosen_match_action? }`
- `POST /review-tasks/:id/cancel`

## State matching (async)

- `POST /state-matching/preflight` — body `{ companyIds: string[] }` (synchronous). Response includes **`automation_buckets`** (`utah_company_ids`, `florida_company_ids`, `iowa_company_ids`, **`unsupported`** with `{ company_id, state }` for ready companies not UT/FL/IA).
- `POST /state-matching/batches` — body `{ companyIds: string[] }` (max 50); creates **`reconciliation_runs`** + **`foundry_jobs`** (`job_type: state_matching_batch`), starts **Step Functions** (`foundry-state-matching-{env}`). Returns **`{ jobId, reconciliation_run_id, executionArn, reused?, preflight, bucket_counts: { utah, florida, iowa } }`**. Returns **400** if any preflight-ready company’s target state is not **UT**, **FL**, or **IA** (body includes **`unsupported`**). Returns **503** if `FOUNDRY_STATE_MATCHING_STATE_MACHINE_ARN` is not configured. Poll **`GET /jobs/:id`** and **`GET /state-matching/batches/:reconciliation_run_id`** for completion.
- `GET /state-matching/batches/:id` — `reconciliation_runs` + `reconciliation_results`

Flow: **Utah**, **Florida**, and **Iowa** companies run in **ECS** (state scraper images, `run-reconciliation.ts`) when their counts are non-zero; otherwise the workflow skips straight to **finalize**. Requires worker-stack exports (cluster, subnets, task definitions, execution + task role ARNs per state) and optional **leads** SSM secret on the tasks for DB writes.

## Reconciliation

- `GET /reconciliation/runs/:id` — same payload as state batch detail (run + results)

## Related

- [services-and-jobs.md](services-and-jobs.md)
- [status-vocabularies.md](status-vocabularies.md)
