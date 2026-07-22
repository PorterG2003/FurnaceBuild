# Client API docs — campaigns & guides

**Guide sources:** [`lib/client-api/openapi/buildingCampaigns.ts`](../../lib/client-api/openapi/buildingCampaigns.ts) (exported via [`scripts/export-client-api-docs.ts`](../../scripts/export-client-api-docs.ts))

**Intro / auth:** [`lib/client-api/openapi/intro.ts`](../../lib/client-api/openapi/intro.ts)

**Concepts:** [`lib/client-api/openapi/concepts.ts`](../../lib/client-api/openapi/concepts.ts)

**Flow object schemas:** [`lib/client-api/openapi/schemas.ts`](../../lib/client-api/openapi/schemas.ts) with slim descriptions in [`lib/client-api/openapi/flowSchemaDescriptions.ts`](../../lib/client-api/openapi/flowSchemaDescriptions.ts)

**Validation error catalog:** [`lib/client-api/openapi/flowValidationErrors.ts`](../../lib/client-api/openapi/flowValidationErrors.ts)

**Live docs:** `/docs` on the deployed Client API host (Fumadocs guides + OpenAPI reference on CloudFront).

Nav structure:

- **Get Started** — Quickstart, Authentication
- **Core Concepts** — Campaigns, Leads and people, Mailboxes, Email sequences, Webhooks
- **Guides** — Campaign setup, Lead management, Handling replies, Webhook integration
- **Webhook events** — payload reference pages
- **Help** — FAQ, Changelog
- **API Reference** tab — Fumadocs OpenAPI UI at `/docs/reference/`

When updating documentation:

- Edit content in the TypeScript builders — do not edit `docs/client-api/content/docs/` by hand (generated and gitignored)
- Edit field-level flow docs in `flowSchemaDescriptions.ts` and per-schema definitions in `schemas.ts`
- Keep the error catalog in `flowValidationErrors.ts` as the single source of truth

## Editing checklist

1. Update markdown builders under `lib/client-api/openapi/`
2. Run `npm run export:client-api-docs` and `npm run dev:client-api-docs` (or `build:client-api-docs`) locally to preview
3. Bump `CLIENT_API_VERSION` in `lib/client-api/openapi/constants.ts` when the contract changes; patch for docs-only updates
4. Run `npm run test:client-api` (or at least `openApiContract.test.ts`)
5. Publish with `npm run deploy:client-api-docs -- --env dev|prod` (backend Amplify deploy does **not** publish docs)

See also [CLIENT_API_DEV_RUNBOOK.md](./CLIENT_API_DEV_RUNBOOK.md), [CLIENT_API_CHANGELOG.md](./CLIENT_API_CHANGELOG.md), and [scripts/seed/scenarios/client-api-campaign-walkthrough/HANDOFF.md](../../scripts/seed/scenarios/client-api-campaign-walkthrough/HANDOFF.md).
