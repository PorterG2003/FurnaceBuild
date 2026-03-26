# Utah Division of Corporations — automated scrape + CSV compare

Headless **Playwright** drives the [Utah Business Registration](https://businessregistration.utah.gov/EntitySearch/OnlineEntitySearch) portal (redirect → **Search Business Entity Records** → business search form). Parsed **principal** rows (Member / Manager / etc.) are compared to enrichment names in `UtahLLCOwnerSearchTester.csv`.

For ECS naming, build/push, and adding other states, see the [State scraper ECS playbook](state-scraper-ecs-playbook.md).

## Components

| Piece | Location |
|-------|----------|
| HTML parsers + scoring | [`lib/foundry/registry-server/utah/`](../../../lib/foundry/registry-server/utah/) |
| Playwright runner + CLI | [`workers/state-scrapers/utah-scraper/`](../../../workers/state-scrapers/utah-scraper/) |
| Captured HTML fixtures | [`lib/foundry/registry-server/fixtures/`](../../../lib/foundry/registry-server/fixtures/) |
| ECS one-shot task | [`infra/workers/lib/worker-stack.ts`](../../../infra/workers/lib/worker-stack.ts) — `furnace-utah-scraper-task-{env}` |

**Path:** **B** — browser automation in production (no stable public API for search/detail without a session). Optional future **Path A** would replay POSTs from a captured HAR if Utah’s forms stay stable.

## Local usage

From repo root (or `workers/state-scrapers/utah-scraper`):

```bash
cd workers/state-scrapers/utah-scraper
npm install
npx playwright install chromium   # first time only
npm test                          # parser unit tests

# Full CSV (respect Utah rate limits)
npx tsx src/run.ts ../../../UtahLLCOwnerSearchTester.csv --out ./utah-scrape-report.json

# Smoke: first N rows
MAX_ROWS=5 RATE_MS=2500 npx tsx src/run.ts ../../../UtahLLCOwnerSearchTester.csv --out ./report.json
```

### Environment variables

| Variable | Purpose |
|----------|---------|
| `INPUT_CSV` | Default CSV path (Docker / ECS). |
| `OUTPUT_JSON` | Report JSON path. |
| `RATE_MS` | Delay between rows (default `2000`). |
| `MAX_ROWS` | Limit rows for testing. |
| `SAVE_RAW_HTML_DIR` | If set, save failing page HTML per `csvId`. |

### Refresh HTML fixtures (optional)

After portal markup changes:

```bash
cd workers/state-scrapers/utah-scraper
npm run capture-fixtures
```

Writes under `lib/foundry/registry-server/fixtures/` (`utah-entity-search-after-click.html`, `utah-entity-search-results.html`, `utah-entity-detail-sample.html`).

## ECS (Fargate RunTask)

1. Deploy **WorkerStack** so ECR repo and task definition exist. CloudFormation exports (and SSM for RunTask):
   - `FurnaceUtahScraperTaskRepo-{env}`
   - SSM `/furnace/ecs/{env}/utah-scraper/task-definition-arn` (latest task definition ARN; Amplify state-matching Lambda reads this at runtime)
   - (reuse) `FurnaceCluster-{env}`, `FurnaceWorkerPublicSubnets-{env}`, `FurnaceWorkerSecurityGroup-{env}`

2. Build and push the image:

```bash
cd infra/workers
./scripts/build-and-push.sh dev utah-scraper
```

3. Run a task with **volume overrides** for input CSV and output (example pattern — mount EFS or use `S3` download in a wrapper; bare RunTask often uses a small init or host volume):

   - Mount **`/data/input.csv`** with your tester CSV.
   - Mount **`/out`** writable for `utah-scrape-report.json`.
   - Override env: `INPUT_CSV=/data/input.csv`, `OUTPUT_JSON=/out/utah-scrape-report.json`, optional `MAX_ROWS`, `RATE_MS`.

Exact `aws ecs run-task` flags depend on your cluster’s capacity provider and whether you attach EFS; mirror the process you use for **Smartlead migration** tasks in [`infra/workers/README.md`](../../../infra/workers/README.md).

### Foundry state matching (reconciliation)

When **`RUN_MODE=reconciliation`**, the container runs [`workers/state-scrapers/utah-scraper/src/run-reconciliation.ts`](../../../workers/state-scrapers/utah-scraper/src/run-reconciliation.ts) instead of the CSV CLI. It reads **`JOB_ID`** from **`foundry_jobs`**, loads **`utah_company_ids`** from the job payload, scrapes Utah for each company, writes **`registry_source_snapshots`** / **`state_entities`** / **`entity_owners`**, and runs the shared **`reconcileCompanyToStateEntity`** scoring. This is invoked automatically by the **state matching Step Functions** flow (Lambda **`RunTask`** + wait), not only by manual `run-task`.

Configure **`DEV_LEADS_SUPABASE_URL`** / **`PROD_LEADS_SUPABASE_URL`** (or **`LEADS_SUPABASE_URL`**) plus **`DEV_SECRET_SSM_PREFIX`** / **`PROD_SECRET_SSM_PREFIX`** in `.env.local`; CDK sets Utah’s **`LEADS_SUPABASE_SECRET_KEY_PARAM_PATH`** to **`{prefix}/LEADS_SUPABASE_SECRET_KEY`**. Details: [WORKER_SSM_AND_AMPLIFY_SECRETS.md](../../../docs/infrastructure/WORKER_SSM_AND_AMPLIFY_SECRETS.md). At runtime [`run-reconciliation.ts`](../../../workers/state-scrapers/utah-scraper/src/run-reconciliation.ts) loads the key from SSM. For local runs you can set **`LEADS_SUPABASE_SECRET_KEY`** directly instead of the path.

## Compliance and reliability

- Keep **low concurrency** and **RATE_MS** to reduce load on the state site; review **terms of use**.
- Utah may change HTML; parsers are covered by **fixtures + tests** — re-run `capture-fixtures` and adjust regexes when the UI changes.
- Search **disambiguation** is heuristic; wrong entity numbers in the report usually mean tie-break or query tuning, not a network failure.

## Related

- [State scraper ECS playbook](state-scraper-ecs-playbook.md) (build, CDK, SSM, RunTask conventions)
- Florida Sunbiz scraper: [`workers/state-scrapers/florida-scraper/`](../../../workers/state-scrapers/florida-scraper/) (ECS image + `florida-scraper` task; see playbook)
- [fixtures README](../../../lib/foundry/registry-server/fixtures/README.md)
- [entity-resolution-operator-guide.md](../product/entity-resolution-operator-guide.md)
