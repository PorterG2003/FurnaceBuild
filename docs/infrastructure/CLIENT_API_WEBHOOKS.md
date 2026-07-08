# Client API webhooks

**Source of truth:** [`lib/client-api/openapi/webhooks.ts`](../../lib/client-api/openapi/webhooks.ts)

**Live docs:** open `/docs/webhooks/` on the deployed Client API host.

When updating webhook documentation, edit `buildWebhooksOverviewMarkdown()` and `buildWebhookEventGroupMarkdown()` in the TypeScript modules above. Example payloads are generated from [`lib/client-api/webhooks/webhookTestSamples.ts`](../../lib/client-api/webhooks/webhookTestSamples.ts) — do not duplicate JSON in markdown files.

## Editing checklist

1. Update webhook markdown builders in `lib/client-api/openapi/webhooks.ts` (and sample builders in `webhookTestSamples.ts` if payload shapes change)
2. Run `npm run test:client-api`
3. After deploy, verify `/docs/webhooks/` and event group pages render correctly

See also [bulk-operations-standards.md](../engineering/bulk-operations-standards.md) for internal bulk webhook rules and [CLIENT_API_DEV_RUNBOOK.md](./CLIENT_API_DEV_RUNBOOK.md).

## Architecture (v1.3.0+)

```
Detection (app persistWebhookEvent OR DB triggers on column changes)
  → INSERT webhook_events
  → AFTER INSERT trigger → pg_net → POST /internal/webhook/enqueue
  → SQS → processWebhookEvent → customer URL
```

**DB-triggered events:** `reply.categorized` (category change on `email_threads`), `campaign.paused` / `campaign.resumed` / `campaign.stopped` (status change on `campaigns`, excluding soft-delete and draft→running).

**App-layer events:** lead CRUD/completions, `email.sent`, `reply.received`, `bounce.detected`. Emitters call [`persistWebhookEvent`](../../lib/client-api/webhooks/persistWebhookEvent.ts) only — no direct SQS enqueue.

**Enqueue idempotency:** `webhook_events.sqs_enqueued_at` is set atomically before SQS send. A reconciliation sweep (`POST /internal/webhook/reconcile`, same `X-Furnace-Internal-Secret` auth) retries rows stuck with `sqs_enqueued_at IS NULL`.

**Granular event selection:** Account and campaign webhook settings store a flat `webhook_enabled_events` array. Empty array means no events are delivered until at least one type is selected. The app UI uses per-event checkboxes grouped by category.

### Adding a new DB-triggered event

1. Add to `webhookEvents.ts` allowlist, `eventGroups.ts`, labels, test samples, OpenAPI
2. Write a thin trigger fn calling `furnace_emit_webhook_event(...)` with a precise `WHEN` clause
3. SQL/outcome test: transition fires, non-transition skips, `SET LOCAL furnace.suppress_webhook_emission = 'true'` suppresses
4. Remove duplicate app emits if any existed — enqueue is automatic via INSERT trigger

Same TS allowlist/docs updates apply for app-layer events, minus the trigger step.
