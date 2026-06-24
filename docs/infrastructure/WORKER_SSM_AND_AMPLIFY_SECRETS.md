# ECS workers and Amplify: SSM secret paths

Amplify Gen 2 and the **ECS worker CDK app** (`infra/workers`) both use AWS Systems Manager Parameter Store for Supabase **secret** keys, but they **do not share a single config file** that names those parameters. You configure workers with **one path prefix per environment**; CDK builds the full parameter names the same way Amplify does under that folder.

## Two deploy surfaces

| Surface | What it does | How workers find parameters |
|--------|----------------|------------------------------|
| **Amplify** (`npx ampx sandbox secret set …`, pipeline secrets) | Creates/updates SSM parameters | Lambdas get resolved references internally |
| **ECS workers** ([`infra/workers/bin/workers.ts`](../../infra/workers/bin/workers.ts)) | Bakes full paths into task definitions at **synth time** | Reads **`DEV_SECRET_SSM_PREFIX`** and **`PROD_SECRET_SSM_PREFIX`**, then appends fixed segments (see below) |

Workers **never** call SSM to discover Amplify’s layout. If your prefix does not match the folder where Amplify wrote secrets, tasks will fail at runtime.

## Fixed suffixes (same as Amplify secret names)

Given a prefix (no trailing slash), CDK and helper scripts use:

| Secret | Full parameter name |
|--------|---------------------|
| Main Supabase service role | `{prefix}/SUPABASE_SECRET_KEY` |
| Resend (transactional email Lambdas) | `{prefix}/RESEND_API_KEY` |
| Million Verifier (lead email scoring script) | `{prefix}/MILLION_VERIFIER_API_KEY` |
| Apollo.io (webinar lead enrichment) | `{prefix}/APOLLO_API_KEY` |
| Registry / leads service role | `{prefix}/LEADS_SUPABASE_SECRET_KEY` |
| Foundry website intelligence (OpenRouter, ECS) | `{prefix}/FOUNDRY_OPENROUTER_API_KEY` |
| Google Places API (New), `googlePlaces` Lambda only | `{prefix}/GOOGLE_PLACES_API_KEY` |

Set the Foundry key with Amplify (same prefix as other sandbox secrets), for example: `npx ampx sandbox secret set FOUNDRY_OPENROUTER_API_KEY`. Set Resend with `npx ampx sandbox secret set RESEND_API_KEY` (used by invitation / platform email Lambdas and `npm run send:email-samples`). Set Million Verifier with `npx ampx sandbox secret set MILLION_VERIFIER_API_KEY` (used by `scripts/lead-sourcing/email-scoring`). Set Apollo with `npx ampx sandbox secret set APOLLO_API_KEY` (used by webinar lead enrichment). Flux LLM uses a separate secret: `OPENROUTER_API_KEY`.

For Flux / Foundry address autocomplete and place details, set a [Maps Platform](https://console.cloud.google.com/google/maps-apis) API key with **Places API (New)** enabled, then: `npx ampx sandbox secret set GOOGLE_PLACES_API_KEY` (use the same command in your deploy pipeline for production). The key is read only by the `googlePlaces` Lambda, not the Expo client.

Examples:

- Prefix `/amplify/furnacebuild/porter-sandbox-387f79dcc1` → main key at `.../SUPABASE_SECRET_KEY`, leads at `.../LEADS_SUPABASE_SECRET_KEY`, Foundry OpenRouter at `.../FOUNDRY_OPENROUTER_API_KEY`.
- Prefix `/amplify/shared/d1jtp0rz0l9mcn` → prod-style shared folder (your account may differ).

If your leads key lives under a **different** prefix than main, this repo’s worker CDK cannot express that with a single prefix; you would need a code change (separate prefix for leads) or relocate parameters in SSM.

## Operator contract

1. In AWS, find the **parent path** of `SUPABASE_SECRET_KEY` for that environment (everything before `/SUPABASE_SECRET_KEY`).
2. Set **`DEV_SECRET_SSM_PREFIX`** / **`PROD_SECRET_SSM_PREFIX`** in **`infra/workers/.env.local`** or repo-root **`.env.local`** (both are loaded by [`workers.ts`](../../infra/workers/bin/workers.ts)).
3. Deploy **`WorkerStack-Dev`** / **`WorkerStack-Prod`** so task definitions get the computed full paths.

**Both stacks are always defined**, so **`PROD_SECRET_SSM_PREFIX`** is required for every synth. Until real prod exists, you can set it equal to **`DEV_SECRET_SSM_PREFIX`**.

If you configure a **leads/registry** Supabase URL for a stack, the leads task env uses **`{prefix}/LEADS_SUPABASE_SECRET_KEY`** automatically (same prefix as main for that stack).

## Discovering the prefix

**From a full parameter name:** if you see `/amplify/.../porter-sandbox-xyz/SUPABASE_SECRET_KEY`, the prefix is `/amplify/.../porter-sandbox-xyz`.

**CLI (list main secret, then strip the suffix):**

```bash
aws ssm describe-parameters \
  --region us-west-2 \
  --parameter-filters "Key=Name,Option=Contains,Values=SUPABASE_SECRET_KEY" \
  --query 'Parameters[].Name' \
  --output text
```

Copy the row you want, remove the trailing `/SUPABASE_SECRET_KEY`, and use the remainder as the prefix.

## Alignment checklist

1. `npx ampx sandbox secret set SUPABASE_SECRET_KEY` (and `LEADS_SUPABASE_SECRET_KEY` if needed).
2. `npx ampx sandbox secret set FOUNDRY_OPENROUTER_API_KEY` when using Foundry website intelligence on ECS (optional if that worker is unused).
3. Confirm parameters exist under one folder per environment (`.../SUPABASE_SECRET_KEY`, `.../LEADS_SUPABASE_SECRET_KEY`, `.../GOOGLE_PLACES_API_KEY` when using the Places proxy, and `.../FOUNDRY_OPENROUTER_API_KEY` when applicable).
4. Set **`DEV_SECRET_SSM_PREFIX`** / **`PROD_SECRET_SSM_PREFIX`** accordingly.
5. `npm run deploy:dev` (and prod when ready) from **`infra/workers`**.
6. `npm run set-secret:dev` writes **`{DEV_SECRET_SSM_PREFIX}/SUPABASE_SECRET_KEY`** unless you pass **`--param`**.

## Related docs

- [`infra/workers/README_ENV_SETUP.md`](../../infra/workers/README_ENV_SETUP.md) — env table and setup flow
- [`docs/infrastructure/SUPABASE_LEADS.md`](./SUPABASE_LEADS.md) — leads project and Utah ECS
- [`docs/infrastructure/REBUILD_AFTER_BRANCH_RECREATE.md`](./REBUILD_AFTER_BRANCH_RECREATE.md) — branch rebuilds and SSM realignment
