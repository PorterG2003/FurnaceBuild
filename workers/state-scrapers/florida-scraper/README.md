# Florida Sunbiz scraper (ECS image)

Browser automation for [Sunbiz](https://search.sunbiz.org) **by entity name**, packaged for Fargate. Shared parsers live in [`lib/foundry/registry-server`](../../../lib/foundry/registry-server/).

## Prerequisites

- **Docker** (BuildKit).
- **Apple Silicon:** Chrome in this image is **linux/amd64** (same as Fargate). Always build and run with **`--platform linux/amd64`** (see below); otherwise the image may fail to build or behave differently.

## Build (repository root)

The Dockerfile expects build context at the **repo root** (it copies `lib/foundry/registry-server` and this package).

```bash
cd /path/to/FurnaceBuild
docker build --platform linux/amd64 \
  -f workers/state-scrapers/florida-scraper/Dockerfile \
  -t florida-scraper:local .
```

Push to ECR for deployed tasks: from [`infra/workers`](../../../infra/workers), `./scripts/build-and-push.sh dev florida-scraper`.

## What matches ECS

The container runs [`docker-entrypoint.sh`](./docker-entrypoint.sh): **Xvfb** on `:99` at **1280×720**, then Node. Playwright uses **headed Chrome** (`channel: 'chrome'`) against that display—the same pattern as Fargate.

The task definition sets `INPUT_CSV`, `OUTPUT_JSON`, `RATE_MS`, and (when configured) leads Supabase env vars; see [`infra/workers/lib/worker-stack.ts`](../../../infra/workers/lib/worker-stack.ts). State matching overrides add `RUN_MODE=reconciliation`, `JOB_ID`, and `RECONCILIATION_RUN_ID` ([`amplify/backend.ts`](../../../amplify/backend.ts)). The image **entrypoint** does not execute the ECS `Command` string; for reconciliation it runs `run-reconciliation-bootstrap.ts` when **`RUN_MODE=reconciliation`** is set—so local parity means setting that variable and the same env names, not copying the `Command` override.

**Fargate sizing (reference):** 1024 CPU units, 2048 MiB memory. You do not need to match this in Docker unless you are debugging OOM or throttling.

## Mode A: CSV batch (default image behavior)

Mount a CSV as **`/data/input.csv`** and an output directory as **`/out`**.

```bash
mkdir -p /path/to/out
docker run --rm --platform linux/amd64 \
  -v /path/to/FloridaLLCOwnerSearchTester.csv:/data/input.csv:ro \
  -v /path/to/out:/out \
  -e RATE_MS=2000 \
  -e MAX_ROWS=3 \
  -e SAVE_RAW_HTML_DIR=/out/raw \
  florida-scraper:local
```

- **`MAX_ROWS`:** optional; limits rows for quick iteration ([`src/run.ts`](./src/run.ts)).
- **`SAVE_RAW_HTML_DIR`:** optional; writes page HTML on some failure outcomes for debugging.

Report paths default to `OUTPUT_JSON=/out/florida-scrape-report.json` (and a sibling `.csv`).

### CSV from leads `companies` (fixed ID list)

To populate **`data/input.csv`** for Compose or Docker from the registry DB, add **`LEADS_SUPABASE_SECRET_KEY`** (service role) next to **`LEADS_SUPABASE_URL`** in the repo-root **`.env.local`**, then:

```bash
cd workers/state-scrapers/florida-scraper
npm run export-csv
```

This uses the default company-ID batch in [`scripts/export-leads-csv-for-florida.mts`](./scripts/export-leads-csv-for-florida.mts). Override with **`FLORIDA_EXPORT_IDS`** (comma-separated UUIDs).

## Mode B: Reconciliation (state-matching ECS)

Same image; set **`RUN_MODE=reconciliation`**. The worker loads `foundry_jobs` by **`JOB_ID`** and processes `payload.florida_company_ids` ([`src/run-reconciliation.ts`](./src/run-reconciliation.ts)).

**Secrets (pick one):**

1. **Service role key (simplest locally):** pass **`LEADS_SUPABASE_SECRET_KEY`**; do not commit it.
2. **SSM parity:** set **`LEADS_SUPABASE_SECRET_KEY_PARAM_PATH`**, **`AWS_REGION`**, and mount AWS credentials into the container (e.g. `~/.aws` → `/home/pwuser/.aws:ro` on the Playwright image user).

```bash
docker run --rm --platform linux/amd64 \
  -e RUN_MODE=reconciliation \
  -e JOB_ID='<uuid>' \
  -e RECONCILIATION_RUN_ID='<uuid>' \
  -e LEADS_SUPABASE_URL='https://<project>.supabase.co' \
  -e LEADS_SUPABASE_SECRET_KEY='<service_role_secret>' \
  florida-scraper:local
```

## Docker Compose (optional)

From **`workers/state-scrapers/florida-scraper/`**:

**CSV profile** — put your CSV at `./data/input.csv`, then:

```bash
docker compose --profile csv up --build
```

**Reconciliation profile** — copy [`.env.florida.local.example`](./.env.florida.local.example) to **`.env.florida.local`** (gitignored), fill in values, then:

```bash
docker compose --profile reconciliation up --build
```

`RUN_MODE=reconciliation` is set in Compose; you do not need it in `.env.florida.local`. For **`LEADS_SUPABASE_SECRET_KEY_PARAM_PATH`**, add AWS credentials to the container (uncomment the `volumes` line on the `reconciliation` service in [`docker-compose.yml`](./docker-compose.yml) or pass an equivalent `-v ~/.aws:/home/pwuser/.aws:ro` with `docker run`).

## More reading

- Shared ECS checklist, logs, and Apple Silicon build note: [state-scraper-ecs-playbook.md](../../../docs/foundry/engineering/state-scraper-ecs-playbook.md)
- Worker infra: [infra/workers/README.md](../../../infra/workers/README.md)
