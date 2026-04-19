# Iowa SOS scraper (local / ECS)

Browser automation for the Iowa Secretary of State business search. Shared parsers, `ownerRowsForIowaDetail`, and `persistIowaRegistryPull` live in [`lib/foundry/registry-server`](../../../lib/foundry/registry-server/).

## Scripts

- **`npm run compare-csv`** — offline baseline vs a CSV (`run-csv-compare.ts`). **Testing only**; see the file header for which names are compared (officers + RA) vs what persistence uses (`ownerRowsForIowaDetail`).
- **`npm run query -- "Company Name"`** — ad hoc headed lookup against Iowa SOS.
- **`npm run reconciliation`** — ECS / production entrypoint used when `RUN_MODE=reconciliation`; loads `JOB_ID`, `RECONCILIATION_RUN_ID`, and leads Supabase env vars, scrapes Iowa SOS, persists with `persistIowaRegistryPull`, then reconciles.

## ECS / production

- **Docker image:** [`Dockerfile`](./Dockerfile) installs **Xvfb** and **Chrome for Testing** so Iowa can run in headed Chrome on Fargate.
- **Entrypoint:** [`docker-entrypoint.sh`](./docker-entrypoint.sh) starts Xvfb, exports `DISPLAY`, then runs reconciliation or local query mode.
- **Required env for reconciliation:** `RUN_MODE=reconciliation`, `JOB_ID`, `RECONCILIATION_RUN_ID`, `LEADS_SUPABASE_URL`, and either `LEADS_SUPABASE_SECRET_KEY` or `LEADS_SUPABASE_SECRET_KEY_PARAM_PATH`.
- **Optional env:** `RATE_MS` (default `2000`), `IOWA_POST_RATELIMIT_COOLDOWN_MS` (default `120000`), `IOWA_HEADLESS=1` only for experiments.

## Headless / Chrome

Set `IOWA_HEADLESS=1` only when explicitly testing headless behavior; the normal production path uses headed Chrome under Xvfb. Keep Playwright in lockstep with the Docker base image, as described in the [state scraper ECS playbook](../../../docs/foundry/engineering/state-scraper-ecs-playbook.md).
