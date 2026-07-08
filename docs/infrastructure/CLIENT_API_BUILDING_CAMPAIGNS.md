# Client API building campaigns & flow schemas

**Guide sources:** [`lib/client-api/openapi/buildingCampaigns.ts`](../../lib/client-api/openapi/buildingCampaigns.ts) (exported via [`scripts/export-client-api-docs.ts`](../../scripts/export-client-api-docs.ts))

**Intro page source:** [`lib/client-api/openapi/intro.ts`](../../lib/client-api/openapi/intro.ts)

**Flow object schemas:** [`lib/client-api/openapi/schemas.ts`](../../lib/client-api/openapi/schemas.ts) with slim descriptions in [`lib/client-api/openapi/flowSchemaDescriptions.ts`](../../lib/client-api/openapi/flowSchemaDescriptions.ts)

**Validation error catalog:** [`lib/client-api/openapi/flowValidationErrors.ts`](../../lib/client-api/openapi/flowValidationErrors.ts)

**Live docs:** `/docs` on the deployed Client API host (unmint/Fumadocs guides + Scalar reference on CloudFront).

- **Guides → Campaign quickstart / flow / launch** — lifecycle, checklist, curl walkthrough, draft-vs-live locking
- **Guides → Flow schemas** — node types, merge variables, normalization, validation codes
- **API Reference** (`/docs/reference/`) — read-only Scalar OpenAPI UI

When updating documentation:

- Edit lifecycle/procedural content in `buildingCampaigns.ts` builders — do not duplicate JSON in markdown under `docs/client-api/content/`
- Edit field-level flow docs in `flowSchemaDescriptions.ts` and per-schema definitions in `schemas.ts`
- Keep the error catalog in `flowValidationErrors.ts` as the single source of truth

## Editing checklist

1. Update markdown builders in `buildingCampaigns.ts`, `intro.ts`, and/or `flowSchemaDescriptions.ts` (and `flowValidationErrors.ts` if codes change)
2. Run `npm run export:client-api-docs` and `npm run build:client-api-docs` locally to preview
3. Bump `CLIENT_API_VERSION` in `lib/client-api/openapi/constants.ts` when the contract changes; patch for docs-only updates
4. Run `npm run test:client-api`
5. After deploy, verify `/docs`, `/docs/reference/`, and `/llms.txt`

See also [CLIENT_API_DEV_RUNBOOK.md](./CLIENT_API_DEV_RUNBOOK.md), [CLIENT_API_CHANGELOG.md](./CLIENT_API_CHANGELOG.md), and [scripts/seed/scenarios/client-api-campaign-walkthrough/HANDOFF.md](../../scripts/seed/scenarios/client-api-campaign-walkthrough/HANDOFF.md).
