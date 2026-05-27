# Client API webhooks

Integrator-facing reference for Furnace Client API outbound webhooks. Internal bulk rules: [bulk-operations-standards.md](../engineering/bulk-operations-standards.md).

## Atomic vs batch

```text
IF async job OR more than one lead in one action
  → Batch tier: exactly ONE completion webhook for that operation
ELSE
  → Atomic tier: lead.created / lead.updated / lead.deleted (etc.)
```

Per-row `lead.created` / `lead.updated` / `lead.deleted` events are **never** emitted during bulk processing.

## Atomic tier

| Action | Event |
| --- | --- |
| `POST /v1/campaigns/{id}/leads` (single) | `lead.created` / `lead.updated` |
| `PATCH …/leads/{leadId}` | `lead.updated` |
| `DELETE …/leads/{leadId}` | `lead.deleted` |
| Campaign pause/stop/resume | `campaign.paused` / `campaign.stopped` / `campaign.resumed` |
| Worker: email sent, reply, bounce | `email.sent` / `reply.received` / `bounce.detected` |

## Batch tier

| `input.operation` | Completion event |
| --- | --- |
| `api_lead_import` | `lead.bulk_import.completed` |
| `add_to_campaign` | `lead.added_to_campaign.completed` |
| `remove_from_campaign` | `lead.removed_from_campaign.completed` |
| `remove_from_all_campaigns` | `lead.removed_from_all_campaigns.completed` |
| `pause_enrollments` | `enrollment.pause_completed` |
| `resume_enrollments` | `enrollment.resume_completed` |

Sync bulk shortcuts (`POST …/leads/bulk`, `…/leads:add`, `…/leads:remove`, enrollment pause/resume) use the same completion events with `source: "sync"` and `job_id: null`.

`enrollment.created` and `enrollment.updated` are **not** emitted.

## Batch payload shape

```json
{
  "job_id": "uuid | null",
  "source": "async | sync",
  "campaign_id": "uuid | null",
  "operation": "remove_from_campaign",
  "counts": { "removed": 42, "skipped": 3, "failed": 1 },
  "errors": [{ "global_lead_id": "...", "message": "..." }],
  "global_lead_ids": ["..."]
}
```

OpenAPI schema: `BatchCompletionWebhookPayload`.

## Account UI picker groups

Checking a group in Account Settings enables all underlying events:

| UI group | Events |
| --- | --- |
| Lead added / updated | `lead.created`, `lead.updated`, `lead.bulk_import.completed`, `lead.added_to_campaign.completed` |
| Lead removed | `lead.deleted`, `lead.removed_from_campaign.completed`, `lead.removed_from_all_campaigns.completed` |
| Enrollment pause / resume | `enrollment.pause_completed`, `enrollment.resume_completed` |
| Campaign status | `campaign.paused`, `campaign.resumed`, `campaign.stopped` |
| Email activity | `email.sent`, `reply.received`, `bounce.detected` |

Implementation: [`lib/client-api/webhooks/eventGroups.ts`](../../lib/client-api/webhooks/eventGroups.ts).

## Poll-first for async jobs

1. `POST /v1/jobs` (or legacy `…/leads/bulk/async`) → job id
2. Poll `GET /v1/jobs/{id}` until `status` is `completed` or `failed`
3. Optionally subscribe to the matching `*.completed` webhook

## `lead.deleted` vs removal completions

- **`lead.deleted`** — single-lead `DELETE …/leads/{leadId}` (atomic)
- **`lead.removed_from_campaign.completed`** — bulk or async remove from one campaign
- **`lead.removed_from_all_campaigns.completed`** — bulk or async remove from all campaigns

Bulk remove does not emit N × `lead.deleted`.

## Code references

| Module | Role |
| --- | --- |
| [`lib/client-api/webhooks/batchCompletion.ts`](../../lib/client-api/webhooks/batchCompletion.ts) | Event type mapping, payload builder, dedupe keys |
| [`lib/client-api/webhooks/emitBatchCompletion.ts`](../../lib/client-api/webhooks/emitBatchCompletion.ts) | Persist batch webhook rows |
| [`amplify/functions/clientApiBulkImport/handler.ts`](../../amplify/functions/clientApiBulkImport/handler.ts) | Async job completion webhooks |
| [`amplify/functions/clientApi/app.ts`](../../amplify/functions/clientApi/app.ts) | Sync route batch webhooks |

Allowed event constants: [`lib/client-api/openapi/constants.ts`](../../lib/client-api/openapi/constants.ts) → `DEFAULT_ALLOWED_WEBHOOK_EVENTS`.
