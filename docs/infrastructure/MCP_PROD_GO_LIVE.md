# MCP production go-live checklist

Do **not** point customers at `mcp.getfurnace.io` until every item below is done.

## Infra

Do **not** point Namecheap at the sandbox (`mcp-dev`) CloudFront. Prod gets its own distribution.

DNS / cert order:

1. **ACM first (Namecheap #1):** Request ACM cert in `us-east-1` for `mcp.getfurnace.io`. Add the ACM validation CNAME in Namecheap. Wait until status is **Issued**.
2. **Amplify env:** Set `MCP_DOMAIN_NAME`, `MCP_CERTIFICATE_ARN`, and the other vars below on the **prod** Amplify branch.
3. **Deploy:** Merge to `main` (or pipeline-deploy). From outputs / Amplify Console, copy `custom.mcpCloudFrontUrl` (e.g. `https://xxxx.cloudfront.net`).
4. **Namecheap #2:** CNAME host `mcp` → `xxxx.cloudfront.net` (no `https://`). This is the Amplify URL you need before the custom domain works.
5. Smoke `https://mcp.getfurnace.io/health`.

Until step 4, you can still dogfood OAuth against the raw `mcpCloudFrontUrl` if OAuth metadata is acceptable for that host.

- [ ] Apply migration `20260723160000_mcp_oauth_and_mailbox_connect.sql` on prod Supabase
- [ ] Apply migration `20260724010000_mcp_user_sessions.sql` on prod Supabase
- [ ] Amplify backend deploy includes `mcp` function
- [ ] `MCP_DOMAIN_NAME=mcp.getfurnace.io` + `MCP_CERTIFICATE_ARN` (ACM `us-east-1`, Issued)
- [ ] `CLIENT_API_BASE_URL=https://api.getfurnace.io`
- [ ] `MCP_APP_ORIGIN=https://build.getfurnace.io`
- [ ] `MCP_OAUTH_SIGNING_SECRET` set (Amplify secret / env)
- [ ] `SUPABASE_SECRET_KEY` available to MCP Lambda
- [ ] DNS for `mcp.getfurnace.io` → **prod** CloudFront (`custom.mcpCloudFrontUrl`)

## Product

- [ ] Account Settings → MCP section visible for owners/admins
- [ ] OAuth consent at `/mcp/oauth/consent` completes Cursor/Claude connect without pasting `f_` keys
- [ ] Client API routes live: `/v1/webhooks`, `/v1/api-keys`, `/v1/mailboxes/connect-sessions`
- [ ] `npm run test:mcp` green
- [ ] New Client API outcome tests green (`accountSettingsOutcomes`) against prod-like DB

## Smoke

- [ ] `GET https://mcp.getfurnace.io/health`
- [ ] `GET https://mcp.getfurnace.io/.well-known/oauth-protected-resource`
- [ ] Cursor OAuth → `tools/list` → `listCampaigns`
- [ ] Deploy a no-op tool description change; new session sees update without user config change

## Monitoring

- [ ] CloudWatch logs for MCP Lambda: `operationId` / status / latency (no PII bodies)
- [ ] Alarm on 5xx rate for MCP Function URL / CloudFront
