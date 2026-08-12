# Bulk operations standards

Canonical rules for bulk/async features in Furnace: UI workbench, Client API jobs, and sync shortcuts must share the same infrastructure and webhook model.

See also: [CLIENT_API_WEBHOOKS.md](../infrastructure/CLIENT_API_WEBHOOKS.md), [test-convention.md](./test-convention.md).

## When to use what

| Scope | Mechanism |
| --- | --- |
| Single lead, sync | Direct RPC or REST atomic endpoint (`POST/PATCH/DELETE …/leads`) |
| ≤ `BULK_SYNC_LIMIT` (100) | Sync bulk RPC or REST `:*` shortcut; one batch webhook when applicable |
| > sync limit, list/view scope, or UI confirm | `api_import_jobs` + `clientApiBulkImport` worker |

Constants live in [`lib/client-api/openapi/constants.ts`](../../lib/client-api/openapi/constants.ts): `BULK_SYNC_LIMIT`, `BULK_ASYNC_LIMIT`, `MAX_ASYNC_JOBS_PER_ACCOUNT`, `MAX_QUEUED_ASYNC_JOBS_PER_ACCOUNT`.

## Shared infrastructure (do not fork)

| Piece | Location |
| --- | --- |
| Job table | `api_import_jobs` — `input.operation`, `cursor`, `progress`, `result`, `errors` |
| Worker | [`amplify/functions/clientApiBulkImport/handler.ts`](../../amplify/functions/clientApiBulkImport/handler.ts) |
| UI enqueue | `start_*_job` RPC → internal import queue |
| API enqueue | `POST /v1/jobs` via [`lib/client-api/jobs.ts`](../../lib/client-api/jobs.ts) |
| Poll | `GET /v1/jobs/{id}` |

## RPC naming conventions

| Pattern | Purpose |
| --- | --- |
| `*_review_summary` | Read-only counts before UI confirm |
| `start_*_job` / `start_*_job_for_list` | Create queued async job |
| `*_for_leads` | Sync mutation by `global_lead_id[]` |
| Scoped bulk | `private_*_scope_ids` + `*_for_scope` ([`20260602120000_leads_bulk_scoped_rpcs.sql`](../../supabase/migrations/20260602120000_leads_bulk_scoped_rpcs.sql)) |

## Scope model

Reuse everywhere:

- `global_lead_ids[]`
- `list_id`
- Explorer filter snapshot (saved view / workbench filters)

Same shape for jobs, list membership RPCs, and Client API job bodies.

## Webhooks

**Never emit per-row lead webhooks during bulk.** Emit exactly one operation-specific `*.completed` event per job or sync bulk action.

Details: [CLIENT_API_WEBHOOKS.md](../infrastructure/CLIENT_API_WEBHOOKS.md).

Integrators should **poll** `GET /v1/jobs/{id}` first; webhooks are optional completion signals.

## Job `input` / `result` contract

Required `input.operation` values:

- `api_lead_import`
- `csv_lead_import_staged`
- `add_to_campaign`
- `remove_from_campaign`
- `remove_from_all_campaigns`
- `pause_enrollments`
- `resume_enrollments`
- `add_to_lead_list`
- `remove_from_lead_list`
- `export_leads`

Standard count keys in `result`: `created`, `updated`, `enrolled`, `removed`, `added`, `paused`, `resumed`, `skipped`, `incomplete`, `failed`, `rows_exported`.

Concurrency: workers claim at most `MAX_ASYNC_JOBS_PER_ACCOUNT` **running** jobs per account. Additional work stays `queued` up to `MAX_QUEUED_ASYNC_JOBS_PER_ACCOUNT`.

`errors[]` entries should include `global_lead_id` when known.

**Bulk lead writes allow blank custom (personalization) fields — never silently drop a row for a missing field. Count it as `incomplete` and surface that count in the UI and API.** `skipped` is reserved for rows that cannot be written at all (e.g. empty email, no source person); a row imported with one or more blank required custom fields is counted in `incomplete`, not `skipped`.

## Client API checklist

When exposing a bulk feature externally:

1. Add OpenAPI path + schema in [`lib/client-api/openapi/`](../../lib/client-api/openapi/)
2. Add outcome test under [`lib/test/client-api/`](../../lib/test/client-api/)
3. Respect rate limits and `MAX_ASYNC_JOBS_PER_ACCOUNT`
4. Document poll vs webhook in OpenAPI description
5. Wire batch completion via [`lib/client-api/webhooks/emitBatchCompletion.ts`](../../lib/client-api/webhooks/emitBatchCompletion.ts) (INSERT-only; enqueue is DB-triggered)

## UI checklist

1. Review modal → confirm → start job → poll job status
2. Reuse workbench modals under [`components/leads/workbench/`](../../components/leads/workbench/)
3. Do not enqueue custom one-off workers

## Testing checklist

Every new operation requires:

- RPC integration outcome test (if RPC owns business truth)
- Client API outcome test (auth, limits, HTTP contract)
- Worker outcome test when async (`clientApiBulkImportOutcomes.test.ts` or extend)
- Unit tests for pure payload/scope helpers

Run: `npm run test:client-api`, `npm run test:campaign:integration`.

## Future feature template

Copy when adding a bulk operation:

| Field | Value |
| --- | --- |
| Operation name | |
| RPCs | |
| Job type (`input.operation`) | |
| Completion event | |
| Webhook picker group | |
| Test files | |
