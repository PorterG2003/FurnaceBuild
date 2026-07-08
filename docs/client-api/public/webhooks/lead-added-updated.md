Single-lead changes and bulk import or add-to-campaign completions.

Examples use placeholder UUIDs. Live deliveries use real ids from your account.

### `lead.created`

A single lead was created via `POST /v1/campaigns/{id}/leads`.

```json
{
  "id": "00000000-0000-4000-8000-0000000000aa",
  "type": "lead.created",
  "occurred_at": "2026-06-25T12:00:00.000Z",
  "data": {
    "campaign_id": "22222222-2222-4222-8222-222222222222",
    "lead_id": "00000000-0000-4000-8000-000000000001",
    "email": "lead@example.com"
  }
}
```

### `lead.updated`

A single lead was updated via `PATCH /v1/campaigns/{id}/leads/{leadId}`.

```json
{
  "id": "00000000-0000-4000-8000-0000000000aa",
  "type": "lead.updated",
  "occurred_at": "2026-06-25T12:00:00.000Z",
  "data": {
    "campaign_id": "22222222-2222-4222-8222-222222222222",
    "lead_id": "00000000-0000-4000-8000-000000000001",
    "email": "lead@example.com"
  }
}
```

### `lead.bulk_import.completed`

An async or sync bulk import finished (`POST /v1/jobs`, `POST …/leads/bulk`, or async bulk endpoint).

```json
{
  "id": "00000000-0000-4000-8000-0000000000aa",
  "type": "lead.bulk_import.completed",
  "occurred_at": "2026-06-25T12:00:00.000Z",
  "data": {
    "job_id": "00000000-0000-4000-8000-000000000007",
    "source": "async",
    "campaign_id": "22222222-2222-4222-8222-222222222222",
    "operation": "api_lead_import",
    "counts": {
      "created": 2,
      "updated": 1,
      "enrolled": 3,
      "skipped": 0,
      "failed": 0
    },
    "errors": []
  }
}
```

### `lead.added_to_campaign.completed`

A sync bulk add-to-campaign action finished (`POST …/leads:add` or equivalent).

```json
{
  "id": "00000000-0000-4000-8000-0000000000aa",
  "type": "lead.added_to_campaign.completed",
  "occurred_at": "2026-06-25T12:00:00.000Z",
  "data": {
    "job_id": null,
    "source": "sync",
    "campaign_id": "22222222-2222-4222-8222-222222222222",
    "operation": "add_to_campaign",
    "counts": {
      "enrolled": 1,
      "skipped": 0,
      "failed": 0
    },
    "errors": [],
    "global_lead_ids": [
      "00000000-0000-4000-8000-000000000008"
    ]
  }
}
```
