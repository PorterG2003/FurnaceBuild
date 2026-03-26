# Registry / company intel Supabase project (`supabase-leads/`)

This database is a **separate Supabase project** from the main Furnace app. It stores company registry data, lead sourcing, matching, reconciliation runs, **immutable source snapshots**, and **row history** for long-term auditability.

## Naming vs the main app

The main app database ([`supabase/`](../../supabase/)) already has a **`leads`** table used for **campaign flow** (enrollments, nodes, etc.). That is unrelated to this project.

Here, **“registry”** / **company intel** means state-entity parsing, `companies`, `entity_owners`, `registry_source_snapshots`, and related tables.

## Directory layout

The Supabase CLI expects **`config.toml` and `migrations/` inside a `supabase/` subfolder** of the workdir (same as the main app). If those files sit at `supabase-leads/config.toml` instead, `migration list` is empty and `db push` applies nothing.

| Path | Role |
| ---- | ---- |
| [`supabase/`](../../supabase/) | Main app database (CLI + migrations) |
| [`supabase-leads/supabase/`](../../supabase-leads/supabase/) | Registry `config.toml` + `migrations/` |
| [`lib/supabase/`](../../lib/supabase/) | Runtime client for the **main** app only |

Do **not** point the Expo app’s `EXPO_PUBLIC_SUPABASE_*` at this project for normal use. Access should go through a **backend service** using the **secret** key (service role bypasses RLS).

## CLI workflow (avoid pushing to the wrong project)

Always set the workdir to **`supabase-leads`** before linking or pushing:

```bash
cd /path/to/FurnaceBuild
supabase --workdir supabase-leads link --project-ref <your-leads-project-ref>
supabase --workdir supabase-leads db push
```

One-time **link** associates the local folder with the remote project. **`db push`** applies files under [`supabase-leads/supabase/migrations/`](../../supabase-leads/supabase/migrations/) to that remote database.

To run **local** Supabase for this project (optional; uses non-conflicting ports vs main `supabase/`):

```bash
supabase --workdir supabase-leads start
```

Local ports are defined in [`supabase-leads/supabase/config.toml`](../../supabase-leads/supabase/config.toml) (e.g. API **54421**, DB **54422**) so it can run alongside the main stack.

## Remote-only workflow

If you skip local `supabase start` for this project, use the dashboard **SQL Editor** to inspect data after `db push`, or connect with `psql` using the pooler connection string from Supabase project settings.

## Schema overview (v1 core + v2 ingest / review)

Initial migration: [`supabase-leads/supabase/migrations/20260322120000_init_registry_schema.sql`](../../supabase-leads/supabase/migrations/20260322120000_init_registry_schema.sql).

Follow-up migrations (same folder, timestamps `2026032314*`) add ingest batches, raw source rows, company links, review queue, matching fields, and integrity rules. Notable additions:

- **Evidence:** `registry_source_snapshots` (raw request/response payloads, `parser_version`).
- **Current rows:** `companies`, `company_locations`, `state_entities`, `entity_owners`, `company_entity_matches`, `reconciliation_runs`, `reconciliation_results` (with matcher/scoring/ruleset versions where applicable).
- **Ingest / provenance:** `ingestion_runs`, `source_business_records`, `source_business_company_links` (plus `source_business_company_link_history` when link rows are updated).
- **Review:** `review_tasks` for manual adjudication (ambiguous matches, duplicates, bad parses).
- **Matching / identity:** `companies.normalized_key` is indexed but **not** globally unique (collisions allowed). `company_entity_matches.registry_state` is denormalized from `state_entities.state` via trigger; partial unique index enforces **at most one current `promoted` match per `(company_id, registry_state)`**.
- **Locations:** optional `normalized_address_key`, coordinates, `source_type`, confidence / deliverability placeholders, `address_hash`.
- **Owners:** optional `owner_normalized_key`, parsed name fields, parse confidence/quality (precursor to a future `people` model).
- **History:** `*_history` tables; `BEFORE UPDATE` triggers on mutable core tables copy the **previous** row into history.
- **Views:** `current_entity_owners`, `current_company_entity_matches` (`is_current = true`), defined with **`security_invoker = true`** so API callers respect underlying RLS (plain views default to definer-style access and show as “UNRESTRICTED” in the dashboard).
- **RLS:** Enabled on all tables (including new ones); **no** policies for `anon` / `authenticated` — only **service role** (or Postgres superuser) is practical for API access.

Cross-system user references (e.g. `changed_by`, `review_tasks.assigned_to`) are stored as **UUID** with **no FK** to the main database.

### Grants checklist (manual)

Migrations in this repo do **not** grant table privileges to `anon` / `authenticated`. If a dashboard export or older setup shows broad `GRANT ALL` on `public` tables, treat that as drift: in the Supabase SQL editor, inspect default privileges and revoke unnecessary grants so only your backend (service role) can read/write sensitive tables. Re-test any PostgREST exposure after changes.

## Environment variables (backend only)

Use in your lead/registry API service (not in the Expo client):

- `LEADS_SUPABASE_URL` — project URL  
- `LEADS_SUPABASE_SECRET_KEY` — secret / service role key  

### Amplify Foundry registry Lambda (`foundryRegistryApi`)

The app reads registry data through a **Lambda Function URL** in [`amplify/backend.ts`](../../amplify/backend.ts), not from the Expo client.

1. **Secrets** (sandbox / branch / prod — same pattern as `SUPABASE_SECRET_KEY`):

   ```bash
   npx ampx sandbox secret set LEADS_SUPABASE_SECRET_KEY
   ```

2. **Synth-time URL:** `LEADS_SUPABASE_URL` is injected from `process.env.LEADS_SUPABASE_URL` when Amplify synthesizes the stack (see `dotenv` loading of `.env.local` in `amplify/backend.ts`). Add it to `.env.local` for local sandbox deploys; ensure CI sets it for `pipeline-deploy` if you deploy from Git.

3. **Outputs:** After deploy, copy `custom.foundryRegistryApiUrl` from the generated outputs into [`amplify_outputs.json`](../../amplify_outputs.json) at the repo root (or pull the file your workflow uses) so [`lib/foundry/registry-client.ts`](../../lib/foundry/registry-client.ts) can reach the API.

4. **Auth:** The Lambda validates the Supabase JWT against the **main** project and requires a `user_access_flags` row with `flag_key = 'foundry'` before querying the registry DB.

5. **Async jobs:** Long-running work records progress in **`foundry_jobs`**; the **normalize** workflow runs as **Step Functions + `foundryNormalizeJob`** in [`amplify/backend.ts`](../../amplify/backend.ts). Optional stub machines live in [`infra/foundry/`](../../infra/foundry/). Details: [FOUNDRY_ORCHESTRATION.md](./FOUNDRY_ORCHESTRATION.md).

### ECS Utah scraper (`infra/workers`)

[`infra/workers/bin/workers.ts`](../../infra/workers/bin/workers.ts) wires Utah the same way as the main Supabase URL and secret paths:

**URLs (mirror main-app env pattern):**

- If **`LEADS_SUPABASE_URL`** is set (typical in `.env.local` next to Amplify) and **`DEV_LEADS_SUPABASE_URL`** is not, the dev worker stack uses **`LEADS_SUPABASE_URL`** — same idea as **`EXPO_PUBLIC_SUPABASE_URL`** filling **`DEV_SUPABASE_URL`** for main.
- **`DEV_LEADS_SUPABASE_URL`** / **`PROD_LEADS_SUPABASE_URL`**, or aliases **`LEADS_SUPABASE_URL_DEV`** / **`LEADS_SUPABASE_URL_PROD`**, work like **`DEV_SUPABASE_URL`** / **`SUPABASE_URL_DEV`**, etc.
- If **`PROD_LEADS_SUPABASE_URL`** is unset but dev leads URL is set, **WorkerStack-Prod** reuses the dev leads URL and logs a warning (same as main **`PROD_SUPABASE_URL`** behavior).

**Leads secret (same pattern as send-worker / `SUPABASE_SECRET_KEY_PARAM_PATH`):**

The Utah task gets **`LEADS_SUPABASE_SECRET_KEY_PARAM_PATH`** as plain environment (not ECS-injected secrets). At startup, [`workers/state-scrapers/utah-scraper/src/run-reconciliation.ts`](../../workers/state-scrapers/utah-scraper/src/run-reconciliation.ts) calls SSM **`GetParameter`** (with decryption), like **`workers/send-worker/src/index.ts`** does for the main key. The **Utah task role** is granted **`ssm:GetParameter`** on that parameter ARN only.

Worker CDK uses **one prefix per stack** (`DEV_SECRET_SSM_PREFIX` / `PROD_SECRET_SSM_PREFIX`). When a leads URL is set, the Utah task gets `{prefix}/LEADS_SUPABASE_SECRET_KEY` automatically (same folder as main `SUPABASE_SECRET_KEY`). If your leads key is not under that folder, relocate it in SSM or adjust the CDK — see [WORKER_SSM_AND_AMPLIFY_SECRETS.md](./WORKER_SSM_AND_AMPLIFY_SECRETS.md).

After `npx ampx sandbox secret set LEADS_SUPABASE_SECRET_KEY` (or pipeline deploy), Amplify creates **`{prefix}/LEADS_SUPABASE_SECRET_KEY`** next to the main secret when both use the same Amplify backend folder.

If SSM fetch fails or the parameter is missing, the Utah process logs and exits (no ECS **ResourceInitializationError** from secret injection). If logs show **`foundry_jobs load failed` `Invalid API key`**, the stored value is not the **leads** project’s service role.

To **disable** leads-backed Utah reconciliation in ECS, unset the leads URL for the worker CDK deploy so [`worker-stack.ts`](../../infra/workers/lib/worker-stack.ts) does not set leads env on the Utah task; the scraper then runs without `LEADS_SUPABASE_*` in the container.

## CI (optional)

Add a job that runs `supabase --workdir supabase-leads db push` with `SUPABASE_ACCESS_TOKEN` and the linked project ref, so merges to your default branch keep the remote schema in sync.
