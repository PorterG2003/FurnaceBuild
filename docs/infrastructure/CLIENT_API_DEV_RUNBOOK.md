# Client API Dev Runbook

This runbook covers the Furnace Client API infrastructure that now lives in the Amplify backend plus the worker stack.

## Required deploy-time environment

Set these before deploying the Amplify backend for the branch/environment that should expose the API:

- `CLIENT_API_DOMAIN_NAME`: public hostname for the API, for example `api-dev.getfurnace.io`
- `CLIENT_API_CERTIFICATE_ARN`: ACM certificate ARN in `us-east-1` for the hostname above
- `CLIENT_API_WAF_WEB_ACL_ARN`: optional CloudFront Web ACL ARN

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

1. Deploy the Amplify backend so the `clientApi` Lambda, CloudFront distribution, and queue exports exist.
2. From `infra/workers`, run `npm run diff:dev` and `npm run deploy:dev` so ECS workers pick up the webhook queue import and env vars.
3. From `infra/workers`, rebuild and restart workers if the worker code changed:
   - `npm run build:dev`
   - `npm run restart:dev`
4. Verify health and docs:
   - `GET https://<client-api-domain-or-cloudfront>/health`
   - `GET https://<client-api-domain-or-cloudfront>/openapi.json`
   - `GET https://<client-api-domain-or-cloudfront>/openapi.json` — confirm guide paths (`/documentation/changelog`, `/documentation/webhooks/...`) and `x-tagGroups`
   - `GET https://<client-api-domain-or-cloudfront>/docs` — confirm single sidebar with **Guide** (Changelog + Webhooks) and **API** sections

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

See [CLIENT_API_CHANGELOG.md](./CLIENT_API_CHANGELOG.md) for where to edit version history (published at `/docs` → **Changelog**).

The Client API inbox surface (`/v1/threads`, `/v1/message-jobs`, `/v1/thread-tags`) supports thread triage, reply/forward jobs, out-of-office updates, lead replacement, and thread tag assignment. Poll outbound send status with `GET /v1/message-jobs/{id}` — not `GET /v1/jobs/{id}`.

Run the integration suite locally:

```bash
npm run test:client-api
```

Contract coverage lives in `lib/test/client-api/openApiContract.test.ts`; inbox outcome tests live in `lib/test/client-api/inboxOutcomes.test.ts`.
