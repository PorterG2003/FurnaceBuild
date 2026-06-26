import { WEBHOOK_EVENT_GROUPS } from '../webhooks/eventGroups.js';
import type { WebhookEventType } from '../webhooks/webhookEvents.js';
import {
  buildWebhookSamplePreview,
  WEBHOOK_DOC_SAMPLE_CONTEXT,
} from '../webhooks/webhookTestSamples.js';

const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEventType, string> = {
  'lead.created': 'A single lead was created via `POST /v1/campaigns/{id}/leads`.',
  'lead.updated': 'A single lead was updated via `PATCH /v1/campaigns/{id}/leads/{leadId}`.',
  'lead.deleted': 'A single lead was deleted via `DELETE /v1/campaigns/{id}/leads/{leadId}`.',
  'lead.bulk_import.completed':
    'An async or sync bulk import finished (`POST /v1/jobs`, `POST …/leads/bulk`, or async bulk endpoint).',
  'lead.added_to_campaign.completed':
    'A sync bulk add-to-campaign action finished (`POST …/leads:add` or equivalent).',
  'lead.removed_from_campaign.completed':
    'A sync bulk remove-from-campaign action finished (`POST …/leads:remove` or equivalent).',
  'lead.removed_from_all_campaigns.completed':
    'A sync bulk remove-from-all-campaigns action finished (`POST …/leads:remove-from-all-campaigns`).',
  'enrollment.pause_completed':
    'A sync bulk enrollment pause finished (`POST …/enrollments:pause` or equivalent).',
  'enrollment.resume_completed':
    'A sync bulk enrollment resume finished (`POST …/enrollments:resume` or equivalent).',
  'campaign.paused': 'The campaign was paused.',
  'campaign.resumed': 'The campaign was resumed.',
  'campaign.stopped': 'The campaign was stopped.',
  'email.sent': 'An outbound campaign email was sent.',
  'reply.received': 'An inbound reply was received on a campaign thread.',
  'bounce.detected': 'A hard or soft bounce was detected for a sent message.',
};

/** Maps webhook event group ids to documentation path segments under `/documentation/webhooks/`. */
export const WEBHOOK_GUIDE_GROUP_PATH_SEGMENTS: Record<string, string> = {
  lead_added_updated: 'lead-added-updated',
  lead_removed: 'lead-removed',
  enrollment_pause_resume: 'enrollment-pause-resume',
  campaign_status: 'campaign-status',
  email_activity: 'email-activity',
};

function buildEventsMarkdown(events: readonly WebhookEventType[]): string {
  const sections: string[] = [];

  for (const event of events) {
    sections.push(
      `### \`${event}\``,
      '',
      WEBHOOK_EVENT_DESCRIPTIONS[event],
      '',
      '```json',
      buildWebhookSamplePreview(event, WEBHOOK_DOC_SAMPLE_CONTEXT, { includeTestFlag: false }),
      '```',
      '',
    );
  }

  return sections.join('\n');
}

export function buildWebhookEventGroupMarkdown(groupId: string): string {
  const group = WEBHOOK_EVENT_GROUPS.find((entry) => entry.id === groupId);
  if (!group) {
    throw new Error(`Unknown webhook event group: ${groupId}`);
  }

  return [
    group.description,
    '',
    'Examples use placeholder UUIDs. Live deliveries use real ids from your account.',
    '',
    buildEventsMarkdown(group.events),
  ].join('\n');
}

export function buildWebhooksOverviewMarkdown(): string {
  return [
    'Outbound webhooks notify your systems when Furnace events occur. Furnace POSTs JSON to your HTTPS endpoint; your endpoint must return any **2xx** response.',
    '',
    '## Quick start',
    '',
    '1. Open **Account Settings → Webhooks** (or a campaign override in Mission Control).',
    '2. **Configure** — paste an HTTPS URL, optionally set a signing secret, and select event groups. Leave events empty to receive **all** event types.',
    '3. Click **Next** to open the **Test** step. Use **View sample** to inspect JSON for each event type, then **Send test webhook** to POST a sample to your URL.',
    '4. Click **Done** to save. Deliveries start immediately when matching events occur.',
    '',
    'Campaign overrides replace the account URL (and optionally secret or enabled events) for that campaign only. Leave the override URL empty to inherit the account default.',
    '',
    '## Receiving webhooks',
    '',
    'Furnace sends:',
    '',
    '```http',
    'POST {your_url}',
    'Content-Type: application/json',
    'X-Furnace-Event: email.sent',
    'X-Furnace-Delivery: {delivery_id}',
    'X-Furnace-Signature: sha256=...   # when a signing secret is configured',
    '```',
    '',
    'Body envelope:',
    '',
    '```json',
    '{',
    '  "id": "event-uuid",',
    '  "type": "email.sent",',
    '  "occurred_at": "2026-06-25T12:00:00.000Z",',
    '  "data": { ... }',
    '}',
    '```',
    '',
    '- `id` — unique event id (stable across delivery retries for that event).',
    '- `type` — event constant (matches `X-Furnace-Event`).',
    '- `occurred_at` — ISO-8601 timestamp.',
    '- `data` — event-specific payload (see the event group pages in this **Webhooks** section).',
    '',
    '### Test webhooks',
    '',
    'When you use **Send test webhook** in Furnace, the payload uses real event types with `"test": true` inside `data`. The examples in this guide show the **live** shape (no `test` field).',
    '',
    '### Retries and failures',
    '',
    'Furnace retries failed deliveries up to **3** times. Your endpoint must return any **2xx** HTTP status. Non-2xx responses or network errors are recorded in Account Settings → **Failed deliveries**.',
    '',
    'Use `X-Furnace-Delivery` as a unique delivery id for idempotency on your side.',
    '',
    '## Verifying signatures',
    '',
    'When a signing secret is configured, Furnace sets `X-Furnace-Signature` to `sha256=` followed by the hex-encoded HMAC-SHA256 of the **raw JSON request body** (exact bytes POSTed).',
    '',
    'Node.js example:',
    '',
    '```javascript',
    "import crypto from 'node:crypto';",
    '',
    'function verifyFurnaceSignature(secret, rawBody, signatureHeader) {',
    "  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');",
    '  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));',
    '}',
    '```',
    '',
    'Most no-code tools (Zoho Flow, Zapier, Make) can ignore the signature and accept the POST directly.',
    '',
    '## Atomic vs batch',
    '',
    '```text',
    'IF async job OR more than one lead in one action',
    '  → Batch tier: exactly ONE completion webhook for that operation',
    'ELSE',
    '  → Atomic tier: lead.created / lead.updated / lead.deleted (etc.)',
    '```',
    '',
    'Per-row `lead.created` / `lead.updated` / `lead.deleted` events are **never** emitted during bulk processing.',
    '',
    '### Atomic tier',
    '',
    '| Action | Event |',
    '| --- | --- |',
    '| `POST /v1/campaigns/{id}/leads` (single) | `lead.created` / `lead.updated` |',
    '| `PATCH …/leads/{leadId}` | `lead.updated` |',
    '| `DELETE …/leads/{leadId}` | `lead.deleted` |',
    '| Campaign pause/stop/resume | `campaign.paused` / `campaign.stopped` / `campaign.resumed` |',
    '| Worker: email sent, reply, bounce | `email.sent` / `reply.received` / `bounce.detected` |',
    '',
    '### Batch tier',
    '',
    '| Operation | Completion event |',
    '| --- | --- |',
    '| `api_lead_import` | `lead.bulk_import.completed` |',
    '| `add_to_campaign` | `lead.added_to_campaign.completed` |',
    '| `remove_from_campaign` | `lead.removed_from_campaign.completed` |',
    '| `remove_from_all_campaigns` | `lead.removed_from_all_campaigns.completed` |',
    '| `pause_enrollments` | `enrollment.pause_completed` |',
    '| `resume_enrollments` | `enrollment.resume_completed` |',
    '',
    'Sync bulk shortcuts use the same completion events with `source: "sync"` and `job_id: null`. Batch completion `data` matches the `BatchCompletionWebhookPayload` schema in the **Schemas** section.',
    '',
    '`enrollment.created` and `enrollment.updated` are **not** emitted.',
    '',
    '## Campaign overrides',
    '',
    'When a webhook event includes a `campaign_id`, Furnace resolves delivery settings in this order:',
    '',
    '1. **URL** — campaign `webhook_url_override` if set, otherwise account `webhook_url`. If no URL is configured, the event is not delivered.',
    '2. **Signing secret** — campaign override if set, otherwise account secret.',
    '3. **Enabled events** — campaign `webhook_enabled_events_override` if set (array), otherwise account `webhook_enabled_events`. If the resolved list is **empty**, all event types are delivered. If non-empty, only listed types are delivered.',
    '',
    'When the campaign override URL is empty, the account URL and account signing secret are used.',
    '',
    '## No-code tools (Zoho Flow, Zapier, Make)',
    '',
    '1. Create an incoming webhook trigger in your tool and copy its HTTPS URL.',
    '2. Paste the URL in Furnace **Account Settings → Webhooks** and enable **Email activity** (or other groups you need).',
    '3. On the **Test** step, send `email.sent` or `reply.received` and map fields from the sample JSON.',
    '4. No echo-token or custom verification handler is required.',
    '',
    '## Example payloads',
    '',
    'Open the event group pages in this **Webhooks** section for live JSON examples of every event type.',
    '',
    '## Troubleshooting',
    '',
    '| Symptom | Likely cause |',
    '| --- | --- |',
    '| No webhooks received | URL empty, event type filtered out, or campaign override blocking delivery |',
    '| Test works, live events missing | Event group not enabled, or non-2xx response on live delivery |',
    '| Duplicate deliveries | Retries after timeout; dedupe on `X-Furnace-Delivery` |',
    '| Signature verification fails | Body parsed/re-serialized before verify; use raw body bytes |',
  ].join('\n');
}
