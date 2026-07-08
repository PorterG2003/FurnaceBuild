## End-to-end walkthrough

Replace `{base_url}` and `{api_key}` with your Client API base URL and account API key (`Authorization: Bearer f_...`).

### 1. Create a draft campaign

```bash
curl -sS -X POST '{base_url}/v1/campaigns' \
  -H 'Authorization: Bearer {api_key}' \
  -H 'Content-Type: application/json' \
  -d '
{
  "name": "Q2 Outbound",
  "sending_interval_seconds": 1800,
  "mailbox_ids": [
    "c23da7b6-df4e-4d2f-b100-4bb07b7d38d7"
  ],
  "tag_ids": [
    "a1b2c3d4-e5f6-4789-a012-3456789abcde"
  ]
}
'
```

### 2. Save the flow

```bash
curl -sS -X POST '{base_url}/v1/campaigns/1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb/flow' \
  -H 'Authorization: Bearer {api_key}' \
  -H 'Content-Type: application/json' \
  -d '
{
  "nodes": [
    {
      "id": "leadSource-1",
      "type": "leadSource",
      "position": {
        "x": 0,
        "y": 0
      },
      "data": {
        "label": "Lead Bucket",
        "customFieldKeys": [
          "company"
        ],
        "mappedStandardFieldKeys": [
          "email",
          "first_name",
          "last_name"
        ],
        "isRequired": true
      },
      "deletable": false
    },
    {
      "id": "email-1",
      "type": "email",
      "position": {
        "x": 220,
        "y": 0
      },
      "data": {
        "label": "Intro Email",
        "send_mode": "new",
        "variants": [
          {
            "id": "11111111-1111-4111-8111-111111111111",
            "label": "A",
            "subject": "Quick question for {{first_name}}",
            "template": "Hi {{first_name}} - reaching out about {{custom.company}}.",
            "isActive": true,
            "order": 0
          },
          {
            "id": "11111111-1111-4111-8111-111111111112",
            "label": "B",
            "subject": "Following up for {{first_name}}",
            "template": "Hi {{first_name}} - wanted to share a quick idea for {{custom.company}}.",
            "isActive": true,
            "order": 1
          }
        ]
      }
    },
    {
      "id": "waitTime-1",
      "type": "waitTime",
      "position": {
        "x": 460,
        "y": 0
      },
      "data": {
        "label": "Wait 1 day",
        "duration": "1",
        "unit": "days",
        "wait_duration_seconds": 86400
      }
    },
    {
      "id": "email-2",
      "type": "email",
      "position": {
        "x": 700,
        "y": 0
      },
      "data": {
        "label": "Follow-up",
        "send_mode": "new",
        "variants": [
          {
            "id": "22222222-2222-4222-8222-222222222221",
            "label": "A",
            "subject": "Bumping this for {{first_name}}",
            "template": "Hi {{first_name}} - circling back in case this is relevant for {{custom.company}}.",
            "isActive": true,
            "order": 0
          },
          {
            "id": "22222222-2222-4222-8222-222222222222",
            "label": "B",
            "subject": "Any thoughts, {{first_name}}?",
            "template": "Hi {{first_name}} - should I close the loop or send more detail?",
            "isActive": true,
            "order": 1
          }
        ]
      }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "leadSource-1",
      "target": "email-1"
    },
    {
      "id": "e2",
      "source": "email-1",
      "target": "waitTime-1"
    },
    {
      "id": "e3",
      "source": "waitTime-1",
      "target": "email-2"
    }
  ]
}
'
```

### 3. Upload a lead

```bash
curl -sS -X POST '{base_url}/v1/campaigns/1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb/leads' \
  -H 'Authorization: Bearer {api_key}' \
  -H 'Content-Type: application/json' \
  -d '
{
  "email": "alex@acme.com",
  "first_name": "Alex",
  "last_name": "Rivera",
  "custom_lead_data": {
    "company": "Acme Corp"
  }
}
'
```

### 4. Launch

```bash
curl -sS -X POST '{base_url}/v1/campaigns/1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb/launch' \
  -H 'Authorization: Bearer {api_key}' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

## Lifecycle

| Status | Flow topology | Copy / config edits |
| --- | --- | --- |
| `draft` | Fully editable (add/remove nodes, rewire edges, delete variants) | Allowed |
| `running` | Locked — structural edits return `flow_locked` | Allowed (subject, body, wait duration, add variant, toggle active, positions) |
| `paused` | Locked | Allowed |
| `stopped` | Locked | Allowed |

## Draft vs live lock

| Change | Draft | Running / Paused / Stopped |
| --- | --- | --- |
| Add/remove node | Allowed | Blocked (`flow_locked`) |
| Rewire / add / remove edge | Allowed | Blocked (`flow_locked`) |
| Delete or replace variant id | Allowed | Blocked (`flow_locked`) |
| Edit subject/body/html | Allowed | Allowed |
| Add variant / toggle active | Allowed | Allowed |
| Edit wait duration / categorizer config / node position | Allowed | Allowed |

Structural changes are detected by comparing the stored flow to your payload. When blocked, `change_kind` is `structural` and `change_reasons` includes one or more of: `node_added`, `node_removed`, `node_type_changed`, `edge_added_or_rewired`, `edge_removed_or_rewired`, `variant_removed_or_replaced`.

Validation failures (`400`) return `invalid_flow` with a `details[]` array. See [FlowValidationIssue](/docs/reference/schemas/FlowValidationIssue/) and [Flow schemas](/docs/guides/flow-schemas/) for the full error-code catalog.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `400 invalid_flow` with `details[]` | Validation failed before write | Read `details[].path` and `details[].code`; see [Flow schemas](/docs/guides/flow-schemas/) |
| `403 flow_locked` on `POST .../flow` | Structural edit on a live campaign | Only change copy/config, or duplicate the campaign as a new draft |
| `400` on launch | Missing name, empty flow, or no mailbox | Set name, save flow, assign `mailbox_ids` on create or `PATCH /v1/campaigns/{id}` |
| Lead import missing custom field | `customFieldKeys` on lead source not satisfied | Include every key in `custom_lead_data`; check `GET .../lead-fields` |
