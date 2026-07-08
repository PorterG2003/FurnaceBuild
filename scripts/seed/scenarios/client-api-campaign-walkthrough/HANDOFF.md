# Client API Campaign Walkthrough

Seed a draft campaign, then exercise the v1.4 checklist with curl.

## Prerequisites

```bash
export SEED_ACCOUNT_ID=<account-uuid>
export SEED_OWNER_USER_ID=<user-uuid>
export CLIENT_API_BASE_URL=https://your-client-api.example.com
export CLIENT_API_KEY=f_your_key
```

## Seed

```bash
npx tsx scripts/seed/index.ts --scenario=client-api-campaign-walkthrough
```

Note the printed `campaign_id` and `mailbox_id`.

## Checklist

Replace `{CAMPAIGN_ID}` and `{MAILBOX_ID}` below.

### 0. List mailboxes

```bash
curl -sS "$CLIENT_API_BASE_URL/v1/mailboxes" \
  -H "Authorization: Bearer $CLIENT_API_KEY"
```

### 1. Create campaign (optional — or use seeded id)

```bash
curl -sS -X POST "$CLIENT_API_BASE_URL/v1/campaigns" \
  -H "Authorization: Bearer $CLIENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"API Walkthrough\",\"mailbox_ids\":[\"{MAILBOX_ID}\"]}"
```

### 2. Save flow

Use `GET /v1/flow-templates`, copy from **Guides → Campaign quickstart** at `/docs/guides/campaign-quickstart/`, or open **Flow schemas** and the **API Reference** for the full flow JSON schema.

Validate without writing:

```bash
curl -sS -X POST "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}/flow:validate" \
  -H "Authorization: Bearer $CLIENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d @flow.json
```

Dry run (no DB write):

```bash
curl -sS -X POST "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}/flow?dry_run=true" \
  -H "Authorization: Bearer $CLIENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d @flow.json
```

With concurrency — read revision, save with matching `If-Match`, save again:

```bash
REV=$(curl -sS "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}/flow" \
  -H "Authorization: Bearer $CLIENT_API_KEY" | jq -r '.data.flow_revision')

curl -sS -X POST "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}/flow" \
  -H "Authorization: Bearer $CLIENT_API_KEY" \
  -H "Content-Type: application/json" \
  -H "If-Match: $REV" \
  -d @flow.json

REV2=$(curl -sS "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}/flow" \
  -H "Authorization: Bearer $CLIENT_API_KEY" | jq -r '.data.flow_revision')

curl -sS -X POST "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}/flow" \
  -H "Authorization: Bearer $CLIENT_API_KEY" \
  -H "Content-Type: application/json" \
  -H "If-Match: $REV2" \
  -d @flow-updated.json
```

### 3. Add leads

```bash
curl -sS -X POST "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}/leads" \
  -H "Authorization: Bearer $CLIENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"walkthrough@example.com","first_name":"Walk","custom_lead_data":{"company":"Acme"}}'
```

### 4. Inspect launch + field state

```bash
curl -sS "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}?include=launch_state,lead_field_state" \
  -H "Authorization: Bearer $CLIENT_API_KEY"
```

### 5. Launch

```bash
curl -sS -X POST "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}/launch" \
  -H "Authorization: Bearer $CLIENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 5b. Patch running email node (content-only)

After launch, patch a single email node's copy without replacing the full flow:

```bash
curl -sS -X PATCH "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}/flow/nodes/email-1" \
  -H "Authorization: Bearer $CLIENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"data":{"variants":[{"id":"<variant-id>","label":"A","subject":"Updated subject","template":"Updated body","isActive":true,"order":0}]}}'
```

Use variant ids from your saved flow payload. Lead source and categorizer nodes cannot be patched on live campaigns.

### 6. Pause / resume / stop

```bash
curl -sS -X PATCH "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}/status" \
  -H "Authorization: Bearer $CLIENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"paused"}'

curl -sS -X PATCH "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}/status" \
  -H "Authorization: Bearer $CLIENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"running"}'

curl -sS -X PATCH "$CLIENT_API_BASE_URL/v1/campaigns/{CAMPAIGN_ID}/status" \
  -H "Authorization: Bearer $CLIENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"stopped"}'
```
