# Foundry orchestration (Amplify: normalize + state matching + optional CDK stubs)

**Normalize ingestion** (chunk loop + finalize/fail) runs in **Amplify Gen 2**: `foundryNormalizeJob` Lambda and its **Step Functions** state machine are defined in [`amplify/backend.ts`](../../amplify/backend.ts). The **`foundryRegistryApi`** Lambda creates **`foundry_jobs`** rows and calls **`states:StartExecution`**; the state machine ARN and IAM are wired from CDK references (no manual `FOUNDRY_NORMALIZE_STATE_MACHINE_ARN` in `.env.local`).

**State matching** (Utah ECS + Florida ECS in **parallel**, then finalize) uses **`foundry-state-matching-{env}`** Step Functions with **`ecs:runTask.sync`** in [`amplify/backend.ts`](../../amplify/backend.ts); **`foundryStateMatchingJob`** Lambda only **finalize** / **fail** (no in-Lambda ECS wait). **`POST /state-matching/batches`** creates **`foundry_jobs`** (`job_type: state_matching_batch`) and starts that state machine; **`FOUNDRY_STATE_MATCHING_STATE_MACHINE_ARN`** is injected like normalize. The state machine role uses **worker stack** exports (cluster, subnets, SG, Utah and Florida task definition ARNs from SSM, execution + task role ARNs). Deploy **`infra/workers`** before Amplify when using state reconciliation.

Optional **`infra/foundry`** deploys **stub** state machines only (`foundry-bulk-resolve-stub-*`, `foundry-state-match-stub-*`) for future Phase 2–3 wiring; the live API uses the Amplify state machines above, not these stubs.

## Prerequisites (normalize on Amplify)

1. **Registry database:** Apply `supabase-leads` migrations (includes **`foundry_jobs`** — [`20260326120000_foundry_jobs.sql`](../../supabase-leads/supabase/migrations/20260326120000_foundry_jobs.sql)).
2. **Amplify secrets:** `LEADS_SUPABASE_SECRET_KEY` (same as `foundryRegistryApi`; `npx ampx sandbox secret set LEADS_SUPABASE_SECRET_KEY`).
3. **Synth-time URL:** `LEADS_SUPABASE_URL` in `.env.local` (or CI) so both `foundryRegistryApi` and `foundryNormalizeJob` receive the leads project URL at deploy.

**Utah ECS:** Set **`DEV_SECRET_SSM_PREFIX`** / **`PROD_SECRET_SSM_PREFIX`** so task defs get `{prefix}/LEADS_SUPABASE_SECRET_KEY` — see [WORKER_SSM_AND_AMPLIFY_SECRETS.md](./WORKER_SSM_AND_AMPLIFY_SECRETS.md).

## Deploy

```bash
# From repo root — creates normalize Lambda + state machine + API wiring
npx ampx sandbox
# or pipeline / prod deploy per your Amplify workflow
```

After deploy, `custom.foundryNormalizeStateMachineArn` appears in Amplify outputs (for debugging); the API Lambda already has `FOUNDRY_NORMALIZE_STATE_MACHINE_ARN` set.

If the normalize stack fails to synthesize or deploy, async **`POST /ingestion-runs/:id/jobs/normalize`** can return **503**; synchronous **`POST /ingestion-runs/:id/normalize-records`** still works.

## Optional: stub stacks only (`infra/foundry`)

No leads URL or SSM is required for stubs.

```bash
cd infra/foundry
npm install
CDK_DEFAULT_ACCOUNT=123456789012 npx cdk deploy FoundryStack-Dev
```

Outputs: **`BulkResolveStubStateMachineArn`**, **`StateMatchingStubStateMachineArn`**.

## Operations

- **Execution history:** AWS Console → Step Functions → `foundry-normalize-ingestion-<dev|prod>` or `foundry-state-matching-<dev|prod>` (name uses `WORKER_ENVIRONMENT` / `ENVIRONMENT`, same helper as other workers — default `dev`).
- **App polling:** `GET /jobs/:id` reads **`foundry_jobs`** (source of truth for UI).
- **Stuck jobs:** See [../foundry/operations/runbooks.md](../foundry/operations/runbooks.md).

## Related

- [../foundry/engineering/registry-api.md](../foundry/engineering/registry-api.md)
- [SUPABASE_LEADS.md](SUPABASE_LEADS.md)
