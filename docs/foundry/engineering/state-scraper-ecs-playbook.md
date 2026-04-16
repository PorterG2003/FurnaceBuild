# State scraper ECS playbook

Checklist for adding or operating **registry browser scrapers** on Fargate (Utah, Florida, future states). State-specific behavior (portals, parsers) lives in code and per-state docs; this page is the **shared infra contract**. For **data semantics** (officers vs RA, `raw_parsed` vs `entity_owners`, parser versioning, compare parity), follow [State registry scraper contract](./state-registry-scraper-contract.md).

## Repository layout

- Worker code: `workers/state-scrapers/{state}-scraper/` (e.g. `utah-scraper`, `florida-scraper`).
- Shared parsers and comparison helpers: [`lib/foundry/registry-server/`](../../../lib/foundry/registry-server/) (`scrapers/`, `utah/`, `florida/`, etc.).
- Docker **build context** is always the **repository root** (so Dockerfiles can `COPY lib/foundry/registry-server` and `COPY workers/state-scrapers/...`).

## Dockerfile

- Base: `mcr.microsoft.com/playwright:v1.58.2-noble` (or whatever version matches that worker’s `package.json` `playwright` — **keep them in lockstep**).
- `WORKDIR /app`, copy registry-server + one scraper package, `npm install` in the scraper directory, `ENV NODE_ENV=production`.
- Defaults: `INPUT_CSV=/data/input.csv`, `OUTPUT_JSON=/out/{state}-scrape-report.json` (paths are overridden at RunTask time as needed).
- **CMD patterns:**
  - **CSV batch:** `npx tsx src/run.ts "$INPUT_CSV" --out "$OUTPUT_JSON"` (Florida today).
  - **Reconciliation:** Utah uses a shell branch on `RUN_MODE=reconciliation` → `run-reconciliation.ts`; new states should follow the same pattern when Step Functions / jobs are wired.
- **Florida only:** The image installs **Xvfb** and **Chrome for Testing** (`npx playwright install chrome`, same Playwright version as the base tag) and runs the scraper under **`xvfb-run`** via [`docker-entrypoint.sh`](../../../workers/state-scrapers/florida-scraper/docker-entrypoint.sh) so Sunbiz’s headed Playwright fallback (`channel: 'chrome'`) has a virtual display on Fargate. Rebuild and push the image after changing this setup.

## WorkerStack (CDK)

In [`infra/workers/lib/worker-stack.ts`](../../../infra/workers/lib/worker-stack.ts), for each state scraper:

| Item | Convention |
|------|------------|
| ECR repository | `furnace/{state}-scraper-${environment}` |
| Log group | `/ecs/furnace/{state}-scraper-task-${environment}` |
| Task definition family | `furnace-{state}-scraper-task-${environment}` |
| Container name | `{state}-scraper` (must match `RunTask` `containerOverrides[].name`) |
| CPU / memory | Match Utah unless the portal needs less/more (Utah/Florida: 1024 CPU, 2048 MiB). |
| Task role | Logs to that log group; if Foundry **leads** reconciliation is used, grant `ssm:GetParameter` on the same leads secret path as Utah (`leadsSupabaseUrl` + `leadsSupabaseSecretParamPath` when both set). |
| SSM parameter | `/furnace/ecs/${environment}/{state}-scraper/task-definition-arn` |
| CloudFormation outputs | `Furnace{PascalCaseState}ScraperTaskRepo-${environment}`, `Furnace{PascalCaseState}ScraperTaskRole-${environment}` |

Expose `public readonly {state}ScraperTaskRepo` on `WorkerStack` if other constructs need it.

## Build and push

[`infra/workers/scripts/build-and-push.sh`](../../../infra/workers/scripts/build-and-push.sh):

- Extend worker name validation and usage text.
- `dockerfile_path_for_worker`: `utah-scraper` and `florida-scraper` use `workers/state-scrapers/$name/Dockerfile`.
- `get_repo_uri`: map worker name to the CDK output key (e.g. `FloridaScraperTaskRepoUri`).
- Include the worker in the `all` build list.

Build from repo root:

```bash
cd infra/workers
./scripts/build-and-push.sh dev {state}-scraper
```

**Florida / local Docker on Apple Silicon:** `npx playwright install chrome` in the image supports **linux/amd64** only (matches Fargate). To build locally, use `docker build --platform linux/amd64 -f workers/state-scrapers/florida-scraper/Dockerfile .` from the repo root.

### Local parity runs (Florida)

To reproduce **Fargate-like** behavior on your machine (Xvfb, headed Chrome on linux/amd64, same env contract as state matching), use the step-by-step **`docker run` and `docker compose`** instructions in [`workers/state-scrapers/florida-scraper/README.md`](../../../workers/state-scrapers/florida-scraper/README.md).

## Amplify pipeline

[`amplify.yml`](../../../amplify.yml) preBuild checks SSM parameters exist so backend deploy fails if the worker stack was not deployed. Add:

`/furnace/ecs/$WORKER_ENVIRONMENT/{state}-scraper/task-definition-arn`

Only add `Furnace{State}ScraperTaskRole-{env}` to **REQUIRED_EXPORTS** when Amplify needs that export (today the **state-matching Step Functions** role uses PassRole for Utah and Florida task roles; the finalize Lambda does not call ECS).

## Step Functions / orchestration

**`foundry-state-matching-{env}`** runs Utah and Florida **in parallel** using Step Functions **`ecs:runTask.sync`** (CustomState in [`amplify/backend.ts`](../../../amplify/backend.ts)): each branch is a **Choice** (skip when `utahCount` / `floridaCount` is 0) or a sync RunTask with the same overrides the old Lambda used (Fargate, public subnets, `RUN_MODE=reconciliation`, `JOB_ID`, `RECONCILIATION_RUN_ID`). Completion is **waited on by Step Functions**, not by a 15-minute Lambda poll. [`amplify/functions/foundryStateMatchingJob/handler.ts`](../../../amplify/functions/foundryStateMatchingJob/handler.ts) only **finalize** / **fail** (Supabase updates). Adding another state means another parallel branch, task definition SSM path, PassRole targets, and `ecs:runTask.sync` parameters — mirror Utah/Florida in `backend.ts`.

## Operational notes

- **Cloudflare / bot challenges:** Some portals (e.g. Sunbiz) may block headless browsers from datacenter IPs. Validate with a one-off `RunTask` in dev; mitigations are product-specific. Florida’s container now starts directly in Xvfb-backed headed Chrome to avoid the long headless-first Cloudflare penalty; IP/reputation issues are separate.
- **Input/output:** Tasks default to paths under `/data` and `/out`; mount EFS or use `containerOverrides` / init patterns consistent with your ops model.
- **Florida: prove logs / where it hangs:** The image entrypoint prints `florida-entrypoint-start` before starting **Xvfb**, then `florida-xvfb-start:*`, `florida-xvfb-pid:*`, and `florida-inner-shell-start` before Node/tsx boot. If you see only the first line, the image or stream is wrong; if Xvfb start lines appear but not `florida-inner-shell-start`, the X server failed or died before handoff; if `florida-inner-shell-start` appears but not app JSON logs, the stall is in **Node / tsx / imports** before `main()`. Tail the log group while starting a task (replace `dev` / region if needed):

```bash
aws logs tail /ecs/furnace/florida-scraper-task-dev --follow --region us-west-2
```

## State-specific docs

- Utah (portal + local CLI + ECS): [utah-registry-scraper.md](utah-registry-scraper.md)
- Florida code path + **local ECS-parity Docker:** [`workers/state-scrapers/florida-scraper/README.md`](../../../workers/state-scrapers/florida-scraper/README.md)

## Worker infra overview

ECS cluster, shared execution role, and deploy flow: [`infra/workers/README.md`](../../../infra/workers/README.md).
