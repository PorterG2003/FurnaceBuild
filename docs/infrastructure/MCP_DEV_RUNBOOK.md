# Furnace MCP — internal dogfood (Phase A)

Dev/internal dogfood for the hosted MCP server.

## What it is

Hosted Streamable HTTP MCP at the Amplify Function URL / CloudFront URL from `amplify_outputs.json` → `custom.mcpUrl` (or `mcpFunctionUrl`).

Tools are generated from the Client API OpenAPI document (`operationId` = tool name), plus synthetic discovery tools `listAccounts` / `getAccount`.

**Auth model**
- **OAuth (interactive):** user-scoped, multi-account. Connect once, grant workspaces at consent. Session tokens are opaque `mcpu_…` (access + refresh). Pass `account_id` on tools when multiple workspaces are granted.
- **API keys (`f_…`):** account-pinned automation. Unchanged; ignore any `X-Furnace-Account-Id` header.

MCP OAuth **does not** mint `account_api_keys` rows.

## Connect (Cursor) — OAuth

1. Prefer the CloudFront / custom-domain URL (`custom.mcpUrl` + `/mcp`), not the raw Function URL. Lambda Function URLs remap `WWW-Authenticate`; CloudFront answers unauthenticated `/mcp` at the edge with a real `WWW-Authenticate` so Cursor can show **Connect**.
2. After Amplify deploy, copy `custom.mcpUrl` from `amplify_outputs.json`.
3. Add to Cursor MCP settings (remote / HTTP) — **no** API key headers:

```json
{
  "mcpServers": {
    "furnace-dev": {
      "url": "https://mcp-dev.getfurnace.io/mcp"
    },
    "furnace": {
      "url": "https://mcp.getfurnace.io/mcp"
    }
  }
}
```

4. Settings → Tools & MCP → **Connect** on `furnace-dev`. Browser opens the standalone consent page at `MCP_APP_ORIGIN` + `/mcp/oauth/consent`.
5. If signed out, use **Sign in** — you return to the same consent URL with OAuth params intact.
6. Select one or more workspaces, then **Approve**. The grant is a snapshot; workspaces joined later require reconnecting.
7. In chat, call `listAccounts` first when you may have multiple workspaces, then pass `account_id` on write tools.
8. Revoke sessions from Account Settings → MCP, or via `POST /oauth/revoke`.

Consent app must be reachable (`MCP_APP_ORIGIN=http://localhost:8081` for sandbox dogfood, or the hosted app origin).

### Advanced: API key (no OAuth)

```json
{
  "mcpServers": {
    "furnace-dev": {
      "url": "https://mcp-dev.getfurnace.io/mcp",
      "headers": {
        "Authorization": "Bearer f_YOUR_DEV_KEY"
      }
    }
  }
}
```

Create a key in Account Settings → API keys. Prefer OAuth for interactive use. API keys stay account-pinned.

### Stateful tools note

`createMailboxConnectSession` returns a `connect_url` that a human must open in the Furnace web app. The browser session's active account may differ from the MCP `account_id` — surface the URL and the target workspace name.

Env for sandbox without custom domain:

- `CLIENT_API_BASE_URL` — Client API origin the MCP proxy should call (e.g. `https://api-dev.getfurnace.io`)
- `MCP_DOMAIN_NAME` / `MCP_CERTIFICATE_ARN` — optional custom domain (`mcp-dev.getfurnace.io`)
- `MCP_SERVER_NAME` — optional override of MCP display name (defaults to `furnace-dev` when domain contains `mcp-dev`, else `furnace`)
- `MCP_SKIP_CUSTOM_DOMAIN=true` — skip custom domain (Function URL / CloudFront only)

## Manual dogfood checklist

1. `listAccounts`
2. `getLimits`
3. `listCampaigns` (with `account_id` if multiple grants)
4. `getCampaign` (verify `mailbox_ids` + lead-source `bucketId`)
5. Bulk path: `previewBulkOperation` → `enrollPeople` / `createStagedLeadImport` → poll `getAsyncImportJob`
6. Prefer server-side scopes over paging `listCampaignLeads`; use `exportPeople` for full dumps
7. Do **not** pass local filesystem paths — use staged JSON append or optional `createBulkUploadUrl`
8. `listThreads`

See also: [`MCP_LIMITATIONS.md`](./MCP_LIMITATIONS.md) (capabilities + remaining limits).

## Tests

```bash
npm run test:mcp
npm run test:client-api
```

Covers session/oauth/account-selection unit tests plus `mcpUserAuthOutcomes` when DB env is present. Bulk-first business outcomes live in `lib/test/client-api/bulkFirstMcpOutcomes.test.ts`.

## Deploy notes

1. Apply migration `20260724010000_mcp_user_sessions.sql` (adds `mcp_oauth_sessions`, extends auth codes, purges legacy access tokens).
2. Apply migration `20260812160000_bulk_first_mcp_jobs.sql` (cancel/claim, list membership jobs, previews, uploads).
3. Deploy MCP + Client API Lambdas that stop writing plaintext `api_key_secret`.
4. Later follow-up: drop `api_key_secret` columns once the new code is live everywhere.
5. Existing OAuth connections break once — users reconnect.
