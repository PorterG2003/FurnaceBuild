# Admin UI outline

Maps Foundry concepts to **Expo routes** under **`/foundry/*`**. File roots: [`app/(foundry)/foundry/`](../../../app/(foundry)/foundry/).

Access control: main DB **`user_access_flags`** (`flag_key = 'foundry'`). See [`app/(foundry)/README.md`](../../../app/(foundry)/README.md).

## Dashboard

- **Route:** `/foundry` — [`index.tsx`](../../../app/(foundry)/foundry/index.tsx)  
- **Purpose:** Landing / nav hub (“Upload, jobs, export” workspace).  
- **Schema touchpoints:** None directly; links to other screens.

## Ingestion runs page

- **Route:** `/foundry/imports` (runs list) and import wizard under `/foundry/imports/*`.  
- **Purpose:** List **`ingestion_runs`**, drill into **`source_business_records`**; **records** screen can normalize keys and bulk auto-resolve.  
- **Workflow:** [../workflows/ingest-source-data.md](../workflows/ingest-source-data.md)

## Source record review page

- **Route:** `/foundry/source-records/[id]` — [`source-records/[id].tsx`](../../../app/(foundry)/foundry/source-records/[id].tsx)  
- **Purpose:** Inspect `source_business_records` (API JSON), generate candidates, create company+link, reject candidates.  
- **Workflow:** [../workflows/resolve-raw-to-company.md](../workflows/resolve-raw-to-company.md)

## Company detail page

- **Route:** `/foundry/companies/[id]` — [`companies/[id].tsx`](../../../app/(foundry)/foundry/companies/[id].tsx)  
- **Purpose:** Show **`companies`**, **`company_locations`**, **`source_business_company_links`**, **`company_entity_matches`** (API JSON).  
- **API:** **`GET /companies/:id`** ([`foundryRegistryApi/foundryApiRoutes.ts`](../../../amplify/functions/foundryRegistryApi/foundryApiRoutes.ts)).

## Registry lookup page

- **Route:** *Planned*  
- **Purpose:** Trigger or display **`registry_source_snapshots`**, parsed **`state_entities`** / **`entity_owners`**.  
- **Workflow:** [../workflows/registry-lookup-and-parse.md](../workflows/registry-lookup-and-parse.md)

## Reconciliation page

- **Route:** *Planned*  
- **Purpose:** Show **`reconciliation_runs`**, **`reconciliation_results`**, match statuses.  
- **Workflow:** [../workflows/reconcile-company-to-state-entity.md](../workflows/reconcile-company-to-state-entity.md)

## Review queue page

- **Route:** `/foundry/review` — [`review/index.tsx`](../../../app/(foundry)/foundry/review/index.tsx)  
- **Purpose:** List pending **`review_tasks`**; resolve **`source_link_review`** (company UUID) and **`entity_match_review`** (promote/reject).  
- **Workflow:** [../workflows/review-and-adjudication.md](../workflows/review-and-adjudication.md)

## State matching (orchestration / UT–FL)

- **Route:** `/foundry/state-matching` — [`state-matching/index.tsx`](../../../app/(foundry)/foundry/state-matching/index.tsx) (redirects to imports; panel also on import results)  
- **Purpose:** Preflight and run **Utah/Florida** state-matching batch via ECS; non-UT/FL ready companies are rejected at API start.  
- **Workflow:** [../workflows/state-entity-matching.md](../workflows/state-entity-matching.md)

## Audit / history views

- **Route:** *Planned* (could be tabs on company / match / link detail).  
- **Purpose:** Read from **`_history`** tables or snapshot JSON in app with service-backed API.

## Export page

- **Route:** `/foundry/export` — [`export.tsx`](../../../app/(foundry)/foundry/export.tsx)  
- **Purpose:** View and filter **export read model** rows (one row per current `entity_owner` on a **promoted** `company_entity_match`), with explicit readiness columns and CSV download on web.  
- **API:** `GET /export/company-owner-leads` on the Foundry registry Lambda; backed by view `export_company_owner_leads` in the leads DB.

## Screens that exist today

| Route | File | Notes |
|-------|------|--------|
| `/foundry` | `index.tsx` | Placeholder home |
| `/foundry/upload` | `upload.tsx` | Upload UI (wire to ingest API) |
| `/foundry/jobs` | `jobs.tsx` | Jobs UI |
| `/foundry/export` | `export.tsx` | Export UI (registry-grounded owner rows + CSV) |

## Related

- [../overview.md](../overview.md)
- [../engineering/security-and-access.md](../engineering/security-and-access.md)
