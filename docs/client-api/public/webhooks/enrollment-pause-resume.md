Manual enrollment holds and bulk pause/resume completions.

Examples use placeholder UUIDs. Live deliveries use real ids from your account.

### `enrollment.pause_completed`

A sync bulk enrollment pause finished (`POST …/enrollments:pause` or equivalent).

```json
{
  "id": "00000000-0000-4000-8000-0000000000aa",
  "type": "enrollment.pause_completed",
  "occurred_at": "2026-06-25T12:00:00.000Z",
  "data": {
    "job_id": null,
    "source": "sync",
    "campaign_id": "22222222-2222-4222-8222-222222222222",
    "operation": "pause_enrollments",
    "counts": {
      "paused": 1,
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

### `enrollment.resume_completed`

A sync bulk enrollment resume finished (`POST …/enrollments:resume` or equivalent).

```json
{
  "id": "00000000-0000-4000-8000-0000000000aa",
  "type": "enrollment.resume_completed",
  "occurred_at": "2026-06-25T12:00:00.000Z",
  "data": {
    "job_id": null,
    "source": "sync",
    "campaign_id": "22222222-2222-4222-8222-222222222222",
    "operation": "resume_enrollments",
    "counts": {
      "resumed": 1,
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
