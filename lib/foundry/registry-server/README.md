# `@furnace/registry-server`

Shared **Foundry** logic that talks to the Leads Supabase schema: normalization, resolution, dedupe, state-registry reconciliation, contact enrichment, and HTML parsers used by state scrapers.

## Where this fits

- **HTTP API** (auth, routing, job starts) lives in [`amplify/functions/foundryRegistryApi/`](../../../amplify/functions/foundryRegistryApi/).
- **This package** is imported by that Lambda, other Foundry workers (normalize, autolink, contact enrichment, etc.), and ECS state scrapers.
- The **app** calls the registry API through [`lib/foundry/registry-client.ts`](../registry-client.ts).

## How to import

Use the package barrel only:

```ts
import { normalizeIngestionRunRecords } from '@furnace/registry-server';
```

Avoid deep imports (e.g. `@furnace/registry-server/ingestion/...`) so internal file layout can change without breaking consumers.

## Folder map

| Directory | Role |
|-----------|------|
| `ingestion/` | Source record normalization (`resolution_meta`, ingestion-run batches) |
| `resolution/` | Entity resolution (candidates, link source records to companies) |
| `dedupe/` | Company and entity-owner dedupe + review hooks |
| `reconciliation/` | Company ↔ state entity matching versions and batch matching |
| `state-persistence/` | Persist state registry snapshots, owners, display-name helpers (UT, FL, IA, …) |
| `contact-enrichment/` | SkipSherpa enrichment + classification rulesets |
| `scrapers/` | Shared name/compare helpers for state parsers |
| `utah/` | Utah SOS HTML parsing and hit picking |
| `florida/` | Florida Sunbiz HTML parsing and hit picking |
| `iowa/` | Iowa SOS HTML parsing, hit picking, owner row mapping |
| `fixtures/` | Captured HTML samples for parser tests (path-stable for scraper tooling) |

Public exports are re-exported from root [`index.ts`](./index.ts).

## Tests

From this directory:

```bash
npm test
```

## More detail

- [State registry scraper contract](../../../docs/foundry/engineering/state-registry-scraper-contract.md) — **who becomes `entity_owners` vs `raw_parsed`, titles, versioning, tests, compare parity**
- [Foundry services and jobs](../../../docs/foundry/engineering/services-and-jobs.md) — how API, this package, and orchestration connect
- [Registry API](../../../docs/foundry/engineering/registry-api.md) — HTTP surface
- [State scraper ECS playbook](../../../docs/foundry/engineering/state-scraper-ecs-playbook.md) — Docker build context and `registry-server` copy
