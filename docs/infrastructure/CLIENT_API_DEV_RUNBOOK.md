# Client API Dev Runbook

This runbook covers the Furnace Client API infrastructure that now lives in the Amplify backend plus the worker stack.

## Required deploy-time environment

Set these before deploying the Amplify backend for the branch/environment that should expose the API:

- `CLIENT_API_DOMAIN_NAME`: public hostname for the API, for example `api-dev.getfurnace.io`
- `CLIENT_API_CERTIFICATE_ARN`: ACM certificate ARN in `us-east-1` for the hostname above
- `CLIENT_API_WAF_WEB_ACL_ARN`: optional CloudFront Web ACL ARN
- `WEBHOOK_ENQUEUE_SECRET`: Amplify **secret** (SSM) for `POST /internal/webhook/enqueue` and `/internal/webhook/reconcile` — must match `furnace_internal_config.webhook_enqueue_secret` in Supabase. Set with `npx ampx sandbox secret set WEBHOOK_ENQUEUE_SECRET` (dev) or Amplify Console → branch **Secrets** (prod). Do not use Hosting environment variables for this value.

If `CLIENT_API_DOMAIN_NAME` and `CLIENT_API_CERTIFICATE_ARN` are omitted, the stack still provisions CloudFront and falls back to the CloudFront distribution hostname.

If sandbox deploy fails with a CloudFront alias conflict (`DNS record points to another CloudFront distribution`), set `CLIENT_API_SKIP_CUSTOM_DOMAIN=true` in `.env.local`, redeploy to create the distribution without the alias, update the Namecheap CNAME to the new `clientApiCloudFrontUrl` hostname, then remove the skip flag and redeploy again to attach `api-dev.getfurnace.io`.

## What gets deployed

- `clientApi` Lambda with a public Function URL
- CloudFront distribution in front of the Function URL
- Optional custom domain and WAF attachment when the environment variables above are present
- `furnace-webhook-events-{env}` SQS queue
- `furnace-client-api-import-{env}` SQS queue
- `processWebhookEvent` Lambda subscribed to the webhook queue
- `clientApiBulkImport` Lambda subscribed to the import queue

The import queue handles all `api_import_jobs` operation types (`api_lead_import`, add/remove, pause/resume). See [bulk-operations-standards.md](../engineering/bulk-operations-standards.md) and [CLIENT_API_WEBHOOKS.md](./CLIENT_API_WEBHOOKS.md).

## Deploy order

0. Apply Supabase migration `20260702120000_webhook_infrastructure.sql` (`npm run apply:migrations` from `infra/workers`). Seed `furnace_internal_config` keys:
   - `webhook_enqueue_url` — full URL to `POST /internal/webhook/enqueue` on the Client API host
   - `webhook_enqueue_secret` — same value as the `WEBHOOK_ENQUEUE_SECRET` Amplify secret on `clientApi`
1. Deploy the Amplify backend so the `clientApi` Lambda, CloudFront distribution, and queue exports exist. The backend no longer builds or uploads the docs site — publish docs separately (see [Docs deployment](#docs-deployment)).
2. From `infra/workers`, run `npm run diff:dev` and `npm run deploy:dev` so ECS workers pick up the webhook queue import and env vars.
3. From `infra/workers`, rebuild and restart workers if the worker code changed:
   - `npm run build:dev`
   - `npm run restart:dev`
4. Verify health and docs:
   - `GET https://<client-api-domain-or-cloudfront>/health`
   - `GET https://<client-api-domain-or-cloudfront>/openapi.json` — confirm no `/documentation/*` phantom paths
   - `GET https://<client-api-domain-or-cloudfront>/docs` — Fumadocs/unmint guides home
   - `GET https://<client-api-domain-or-cloudfront>/docs/guides/campaign-quickstart/` — campaign quickstart with POST /flow checklist
   - `GET https://<client-api-domain-or-cloudfront>/docs/reference/` — read-only Scalar API reference
   - `GET https://<client-api-domain-or-cloudfront>/llms.txt` — agent index
   - `GET https://<client-api-domain-or-cloudfront>/docs/guides/campaign-quickstart.md` — plain markdown mirror

## Docs deployment

The Fumadocs site under `docs/client-api/` is deployed **out-of-band** from the Amplify backend. The S3 bucket and CloudFront distribution are stable infrastructure defined in `amplify/backend.ts`; only their contents change between docs deploys. Content is published with an incremental `aws s3 sync` + CloudFront invalidation — no CloudFormation, no `ampx` deploy, and no worker export checks.

Publish docs:

```bash
# dev  -> https://api-dev.getfurnace.io/docs
npm run deploy:client-api-docs -- --env dev

# prod -> https://api.getfurnace.io/docs
npm run deploy:client-api-docs -- --env prod
```

The script generates content from the TypeScript builders (`npm run export:client-api-docs`), runs `next build` (which flattens the export), then resolves the target bucket and distribution by matching the CloudFront distribution whose alias is the env's API domain — so no Amplify App ID or generated outputs are required. It uses your local AWS credentials/profile and defaults to region `us-west-2`.

Useful flags:

- `--skip-build` — reuse the existing `docs/client-api/out` (retry a failed sync without rebuilding)
- `--skip-invalidation` — sync only, skip the CloudFront invalidation
- `--prune-assets` — delete orphaned `_next/` assets after upload; run only well after a deploy has propagated (see caching notes)
- `--region <region>` — override the AWS region

Required IAM permissions: `cloudfront:ListDistributions`, `cloudfront:CreateInvalidation`, and `s3:PutObject`/`s3:DeleteObject`/`s3:ListBucket` on the docs bucket.

### Caching and invalidation (why deploys used to "not work")

The deploy is race-proof by design:

- **Assets first, immutable, no delete.** Content-hashed files under `_next/` are uploaded before anything else, tagged `Cache-Control: public, max-age=31536000, immutable`, and never deleted in the main pass. Old chunks stay available so any still-cached old HTML keeps resolving while CloudFront/browsers propagate.
- **HTML must-revalidate.** All HTML is stamped `Cache-Control: public, max-age=0, must-revalidate` (re-stamped every deploy, since `s3 sync` skips unchanged files). Browsers and edges never serve stale HTML pointing at asset hashes from a previous build — the previous "no CSS after deploy" symptom.
- **Invalidate `/*`, not `/docs/*`.** The CloudFront viewer-request function rewrites URIs before the cache lookup (`/docs/guides/x/` → `/guides/x/index.html`, `/docs/_next/...` → `/_next/...`), so cache keys are the rewritten ORIGIN paths. Invalidating `/docs` or `/docs/*` matches nothing; the script invalidates `/*`.
- Orphaned old assets accumulate over many deploys; reclaim disk with `--prune-assets` (safe to run once a prior deploy has fully propagated).

### One-time rollout (removing the old CloudFormation upload)

The docs upload used to run as a CloudFormation custom resource inside the backend stack. That has been removed. To finish the switch on an environment that hasn't deployed the change yet:

1. Deploy the backend once so the old `ClientApiDocsDeployment` custom resource is dropped: `npx ampx sandbox` (dev) or push to `main` (prod). Existing docs stay live — the removed resource retains bucket objects by default.
2. From then on, publish docs only with `npm run deploy:client-api-docs -- --env dev|prod`.

## Namecheap DNS

Create a `CNAME` record in Namecheap:

- `Host`: the subdomain portion of `CLIENT_API_DOMAIN_NAME`
- `Value`: the CloudFront distribution hostname from Amplify outputs (`clientApiCloudFrontUrl`, without the `https://` prefix)
- `TTL`: automatic/default is fine

Example:

- `CLIENT_API_DOMAIN_NAME=api-dev.getfurnace.io`
- Namecheap `Host=api-dev`
- Namecheap `Value=dxxxxxxxxxxxx.cloudfront.net`

## Outputs to check

Amplify custom outputs now expose:

- `clientApiUrl`
- `clientApiDocsUrl`
- `clientApiOpenApiUrl`
- `clientApiFunctionUrl`
- `clientApiCloudFrontUrl`
- `clientApiWebhookQueueUrl`
- `clientApiImportQueueUrl`

## Logging

The `clientApi` Lambda writes one JSON log line per request with:

- `service`
- `request_id`
- `method`
- `path`
- `status`
- `duration_ms`
- `account_id`
- `api_key_id`

Unhandled exceptions are also logged as structured JSON so CloudWatch queries can filter by `service = "client-api"`.

## Inbox API (v1.2.0)

See [CLIENT_API_CHANGELOG.md](./CLIENT_API_CHANGELOG.md) for where to edit version history (published at `/docs/changelog/`).

The Client API inbox surface (`/v1/threads`, `/v1/message-jobs`, `/v1/thread-tags`) supports thread triage, reply/forward jobs, out-of-office updates, lead replacement, and thread tag assignment. Poll outbound send status with `GET /v1/message-jobs/{id}` — not `GET /v1/jobs/{id}`.

Run the integration suite locally:

```bash
npm run test:client-api
```

Contract coverage lives in `lib/test/client-api/openApiContract.test.ts`; inbox outcome tests live in `lib/test/client-api/inboxOutcomes.test.ts`.
