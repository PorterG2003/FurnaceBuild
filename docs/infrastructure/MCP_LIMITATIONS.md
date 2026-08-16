# Furnace MCP capabilities & remaining limits

Client API–backed MCP tools for campaign and lead operations. Prefer **server-side scopes** and **one logical job** per bulk intent; Furnace owns selection, chunking, concurrency, and artifacts.

Related constants: [`lib/client-api/openapi/constants.ts`](../../lib/client-api/openapi/constants.ts). Discover live caps via MCP tool `getLimits` (`GET /v1/meta/limits`).

## Supported bulk model

| Concern | Capability |
| --- | --- |
| Scope | `selection`, `explorer_view`, `saved_list`, `saved_list_filtered`, `campaign`, `staged_upload` |
| Exclusions | Other list/campaign, explicit `global_lead_ids`, emails |
| Jobs | One logical job per operation; workers claim up to 3 **running** slots; additional jobs stay **queued** |
| Preview | `previewBulkOperation` → pass `preview_id` on execute |
| Cancel | `cancelBulkJob` |
| Import | Staged JSON append (universal) or optional presigned object upload |
| Export | `exportPeople` → poll job for `download_url` |
| Enroll | `enrollPeople` / `createAsyncJob` with scope + exclusions |
| List membership | `updateLeadListMembership` async add/remove |

## File ingress (important)

The remote MCP Lambda **cannot read a path on the caller’s machine**. Never send `/Users/.../leads.csv` expecting the server to open it.

| Mode | When to use |
| --- | --- |
| Server-side scope | Dataset already in Furnace (campaign/list/filter) — preferred |
| Staged JSON batches | Universal MCP fallback: `createStagedLeadImport` → `appendStagedLeadImportRows` → `finalizeStagedLeadImport` |
| Presigned object upload | Optional: `createBulkUploadUrl` then HTTP PUT; only if the MCP host can upload outside tool calls |

## Campaign readback

- `getCampaign` returns attached `mailbox_ids`.
- Lead-source `bucketId` is normalized to the campaign `bucket_id` on create/save.
- RichText variants derive `body_html` from `template` / `body_text` when HTML would otherwise be empty.

## Remaining limits

- Sync shortcuts remain capped at `BULK_SYNC_LIMIT` (100).
- Inline async `leads[]` remains capped at `BULK_ASYNC_LIMIT` (1,000); use staged import for larger novel datasets.
- Staged append batches are capped at `STAGED_IMPORT_APPEND_LIMIT` (500) **per call**, not per job.
- Listing endpoints stay at `MAX_PAGE_SIZE` (100) for interactive browsing; use export jobs for full dumps.
- Presigned upload requires `LEADS_EXPORT_BUCKET` (or equivalent) in the environment; otherwise use staged JSON.
- Explorer-view preview counts may be approximate until execution resolves filters.

## Lead tags and verification

- On create/bulk/staged import, pass `tags` as **names or aliases** (not UUIDs). Catalog matches are case-insensitive (`Hunter.io` → Hunter). Unknown names create an account-owned tag.
- Tags are person-keyed and persist across campaigns. Do not put them in `custom_lead_data`.
- Pass `email_verification` only when you have a real vendor check (`status`: `ok` / `catch_all` / `invalid` / `unknown` / `disposable`). Do not invent a status. Do not auto-apply Catch-All Domain or Role Account tags from verification.
- Omit both fields to keep 1.11.0 behavior. Unknown extra keys such as `mv_result` are still rejected.

## Acceptance bar

Realistic multi-thousand-lead workflows (import → enroll with exclusions → list membership → export → cancel/idempotency checks) must complete using only public MCP/Client API tools and customer credentials. Service-role DB access is for fixture setup/cleanup only.
