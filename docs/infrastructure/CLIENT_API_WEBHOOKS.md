# Client API webhooks

**Source of truth:** [`lib/client-api/openapi/webhooks.ts`](../../lib/client-api/openapi/webhooks.ts) and [`lib/client-api/openapi/guidePaths.ts`](../../lib/client-api/openapi/guidePaths.ts)

**Live docs:** open `/docs` on the deployed Client API host and expand **Guide → Webhooks** in the Scalar sidebar.

When updating webhook documentation, edit `buildWebhooksOverviewMarkdown()` and `buildWebhookEventGroupMarkdown()` in the TypeScript modules above. Example payloads are generated from [`lib/client-api/webhooks/webhookTestSamples.ts`](../../lib/client-api/webhooks/webhookTestSamples.ts) — do not duplicate JSON in markdown files.

## Editing checklist

1. Update webhook markdown builders in `lib/client-api/openapi/webhooks.ts` (and sample builders in `webhookTestSamples.ts` if payload shapes change)
2. Run `npm run test:client-api`
3. After deploy, verify `/docs` shows **Guide** (Changelog + Webhooks pages) and **API** sections in one sidebar

See also [bulk-operations-standards.md](../engineering/bulk-operations-standards.md) for internal bulk webhook rules and [CLIENT_API_DEV_RUNBOOK.md](./CLIENT_API_DEV_RUNBOOK.md).
