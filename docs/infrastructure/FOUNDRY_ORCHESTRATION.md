# Foundry orchestration (Amplify: normalize + optional CDK stubs)

**Normalize ingestion** (chunk loop + finalize/fail) runs in **Amplify Gen 2**: `foundryNormalizeJob` Lambda and its **Step Functions** state machine are defined in [`amplify/backend.ts`](../../amplify/backend.ts). The **`foundryRegistryApi`** Lambda creates **`foundry_jobs`** rows and calls **`states:StartExecution`**; the state machine ARN and IAM are wired from CDK references (no manual `FOUNDRY_NORMALIZE_STATE_MACHINE_ARN` in `.env.local`).

Optional **`infra/foundry`** deploys **stub** state machines only (`foundry-bulk-resolve-stub-*`, `foundry-state-match-stub-*`) for future Phase 2–3 wiring; the API does not start them yet.

## Prerequisites (normalize on Amplify)

1. **Registry database:** Apply `supabase-leads` migrations (includes **`foundry_jobs`** — [`20260326120000_foundry_jobs.sql`](../../supabase-leads/supabase/migrations/20260326120000_foundry_jobs.sql)).
2. **Amplify secrets:** `LEADS_SUPABASE_SECRET_KEY` (same as `foundryRegistryApi`; `npx ampx sandbox secret set LEADS_SUPABASE_SECRET_KEY`).
3. **Synth-time URL:** `LEADS_SUPABASE_URL` in `.env.local` (or CI) so both `foundryRegistryApi` and `foundryNormalizeJob` receive the leads project URL at deploy.

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

- **Execution history:** AWS Console → Step Functions → `foundry-normalize-ingestion-<dev|prod>` (name uses `WORKER_ENVIRONMENT` / `ENVIRONMENT`, same helper as other workers — default `dev`).
- **App polling:** `GET /jobs/:id` reads **`foundry_jobs`** (source of truth for UI).
- **Stuck jobs:** See [../foundry/operations/runbooks.md](../foundry/operations/runbooks.md).

## Related

- [../foundry/engineering/registry-api.md](../foundry/engineering/registry-api.md)
- [SUPABASE_LEADS.md](SUPABASE_LEADS.md)
