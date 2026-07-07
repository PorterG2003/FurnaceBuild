# Client API building campaigns & flow schemas

**Procedural guide source:** [`lib/client-api/openapi/buildingCampaigns.ts`](../../lib/client-api/openapi/buildingCampaigns.ts) (rendered via [`lib/client-api/openapi/guidePaths.ts`](../../lib/client-api/openapi/guidePaths.ts))

**Flow object schemas (Models):** [`lib/client-api/openapi/schemas.ts`](../../lib/client-api/openapi/schemas.ts) with descriptions in [`lib/client-api/openapi/flowSchemaDescriptions.ts`](../../lib/client-api/openapi/flowSchemaDescriptions.ts)

**Validation error catalog:** [`lib/client-api/openapi/flowValidationErrors.ts`](../../lib/client-api/openapi/flowValidationErrors.ts)

**Live docs:** open `/docs` on the deployed Client API host.

- **Guide → Building campaigns** — lifecycle, curl walkthrough, draft-vs-live locking, troubleshooting
- **Models → CampaignFlow** (and related flow schemas) — field-level flow JSON reference, merge variables, normalization, validation error codes

When updating documentation:

- Edit lifecycle/procedural content in `buildBuildingCampaignsMarkdown()` — do not duplicate JSON in markdown files under `docs/`
- Edit field-level flow docs in `flowSchemaDescriptions.ts` and per-schema definitions in `schemas.ts`
- Keep the error catalog in `flowValidationErrors.ts` as the single source of truth

## Editing checklist

1. Update markdown builders in `buildingCampaigns.ts` and/or `flowSchemaDescriptions.ts` (and `flowValidationErrors.ts` if codes change)
2. Bump `CLIENT_API_VERSION` in `lib/client-api/openapi/constants.ts` when the contract changes; patch for docs-only updates
3. Run `npm run test:client-api`
4. After deploy, verify `/docs` shows **Guide → Building campaigns** and **Models → CampaignFlow** with cross-links

See also [CLIENT_API_DEV_RUNBOOK.md](./CLIENT_API_DEV_RUNBOOK.md), [CLIENT_API_CHANGELOG.md](./CLIENT_API_CHANGELOG.md), and [scripts/seed/scenarios/client-api-campaign-walkthrough/HANDOFF.md](../../scripts/seed/scenarios/client-api-campaign-walkthrough/HANDOFF.md).
