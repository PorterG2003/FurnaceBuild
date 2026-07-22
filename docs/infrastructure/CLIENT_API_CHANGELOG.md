# Client API changelog pointer

**Source of truth:** [`lib/client-api/openapi/changelog.ts`](../../lib/client-api/openapi/changelog.ts) (exported to Fumadocs via [`scripts/export-client-api-docs.ts`](../../scripts/export-client-api-docs.ts))

**Live docs:** open `/docs/changelog/` on the deployed Client API host.

When updating version history, edit `buildChangelogMarkdown()` in the TypeScript module above. Do not duplicate entries in markdown files under `docs/`.

## Editing checklist

1. Update `buildChangelogMarkdown()` in `lib/client-api/openapi/changelog.ts`
2. Bump `CLIENT_API_VERSION` in `lib/client-api/openapi/constants.ts` when the contract changes; patch for docs-only updates
3. Run `npm run test:client-api`
4. After deploy, verify `/docs/changelog/` renders the new section

See also [CLIENT_API_DEV_RUNBOOK.md](./CLIENT_API_DEV_RUNBOOK.md).
