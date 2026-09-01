import { WEBHOOK_EVENT_GROUPS } from '../webhooks/eventGroups.js';
import type { WebhookEventType } from '../webhooks/webhookEvents.js';
import {
  buildWebhookSamplePreview,
  WEBHOOK_DOC_SAMPLE_CONTEXT,
} from '../webhooks/webhookTestSamples.js';
import type { DocLinkMode } from './docLinks.js';
import { guideLink } from './docLinks.js';

export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEventType, string> = {
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
  'lead.added_to_list.completed':
    'A scoped or ID-list add-to-lead-list job finished (`POST /v1/lead-lists/{id}/members:update` or async job).',
  'lead.removed_from_list.completed':
    'A scoped or ID-list remove-from-lead-list job finished (`POST /v1/lead-lists/{id}/members:update` or async job).',
  'lead.export.completed':
    'A people/leads export job finished (`POST /v1/people:export` or async `export_leads`).',
  'enrollment.pause_completed':
    'A sync bulk enrollment pause finished (`POST …/enrollments:pause` or equivalent).',
  'enrollment.resume_completed':
    'A sync bulk enrollment resume finished (`POST …/enrollments:resume` or equivalent).',
  'campaign.paused': 'The campaign was paused.',
  'campaign.resumed': 'The campaign was resumed.',
  'campaign.stopped': 'The campaign was stopped.',
  'email.sent':
    'An outbound campaign email was sent. `data.email` is the lead recipient address for CRM matching. Includes the shared lead identity block, outbound `body_text`, and `step_number` when the scheduler persisted it.',
  'reply.received':
    'An inbound reply was received on a campaign thread (before categorization completes). `data.from_email` is the reply sender; `data.email` is the matched lead. `data.body_text` is the plain-text display body (quoted history stripped).',
  'reply.categorized':
    'A thread reply category was assigned, changed, or cleared (manual, AI, system, or OOO). Includes the same lead identity block as send/reply.',
  'bounce.detected':
    'A hard or soft bounce was detected for a sent message. `data.email` is the matched lead; `candidate_emails` remains for diagnostics. `reason` is `severity` plus the SMTP `code` when present.',
  'unsubscribe.detected':
    'A lead unsubscribed via a reply opt-out. `data.source` is `reply_opt_out`. Includes the shared lead identity block.',
};

/** Maps webhook event group ids to documentation path segments under `/docs/webhooks/`. */
export const WEBHOOK_GUIDE_GROUP_PATH_SEGMENTS: Record<string, string> = {
  lead_added_updated: 'lead-added-updated',
  lead_list_and_export: 'lead-list-and-export',
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

export function buildWebhookEventGroupMarkdown(groupId: string, linkMode: DocLinkMode = 'docs'): string {
  const group = WEBHOOK_EVENT_GROUPS.find((entry) => entry.id === groupId);
  if (!group) {
    throw new Error(`Unknown webhook event group: ${groupId}`);
  }

  return [
    group.description,
    '',
    `These pages are payload reference. For setup, verification, and retries, follow ${guideLink('Webhook integration', '/guides/webhook-integration/', linkMode)}.`,
    '',
    'Examples use placeholder UUIDs. Live deliveries use real ids from your account.',
    '',
    buildEventsMarkdown(group.events),
  ].join('\n');
}

export function buildWebhooksOverviewMarkdown(linkMode: DocLinkMode = 'openapi'): string {
  const eventLinks = WEBHOOK_EVENT_GROUPS.map((group) => {
    const segment = WEBHOOK_GUIDE_GROUP_PATH_SEGMENTS[group.id];
    return segment
      ? `- ${guideLink(group.label, `/webhooks/${segment}/`, linkMode)} — ${group.description}`
      : null;
  }).filter(Boolean);

  return [
    'Outbound webhooks notify your systems when Furnace events occur. Furnace POSTs JSON to your HTTPS endpoint; your endpoint must return any **2xx** response.',
    '',
    `New to webhooks? Start with the short ${guideLink('Webhooks', '/concepts/webhooks/', linkMode)} concept page.`,
    '',
    '## Quick start',
    '',
    '1. Open **Account Settings → Webhooks** (or a campaign override in Mission Control).',
    '2. **Configure** — paste an HTTPS URL, optionally set a signing secret, and select individual events (expand groups to pick specific types). Only selected event types are delivered.',
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
    '- `data` — event-specific payload (see **Webhook events** in the sidebar).',
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
    '## Single actions vs bulk',
    '',
    'A single action (adding one person, one send) fires its own event. A bulk action (an import, or anything touching more than one person at once) fires **one** completion event for the whole operation instead of one per person.',
    '',
    'Per-row `lead.created` / `lead.updated` / `lead.deleted` events are **never** emitted during bulk processing.',
    '',
    '### Single actions',
    '',
    '| Action | Event |',
    '| --- | --- |',
    '| `POST /v1/campaigns/{id}/leads` (single) | `lead.created` / `lead.updated` |',
    '| `PATCH …/leads/{leadId}` | `lead.updated` |',
    '| `DELETE …/leads/{leadId}` | `lead.deleted` |',
    '| Campaign pause/stop/resume | `campaign.paused` / `campaign.stopped` / `campaign.resumed` |',
    '| Worker: email sent, reply, bounce, unsubscribe | `email.sent` / `reply.received` / `bounce.detected` / `unsubscribe.detected` |',
    '| Thread category assign/change/clear | `reply.categorized` |',
    '',
    '### Bulk actions',
    '',
    '| Operation | Completion event |',
    '| --- | --- |',
    '| `api_lead_import` / `csv_lead_import_staged` | `lead.bulk_import.completed` |',
    '| `add_to_campaign` | `lead.added_to_campaign.completed` |',
    '| `remove_from_campaign` | `lead.removed_from_campaign.completed` |',
    '| `remove_from_all_campaigns` | `lead.removed_from_all_campaigns.completed` |',
    '| `add_to_lead_list` | `lead.added_to_list.completed` |',
    '| `remove_from_lead_list` | `lead.removed_from_list.completed` |',
    '| `export_leads` | `lead.export.completed` |',
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
    '3. **Enabled events** — campaign `webhook_enabled_events_override` if set (array), otherwise account `webhook_enabled_events`. If the resolved list is **empty**, no events are delivered. If non-empty, only listed types are delivered.',
    '',
    'When the campaign override URL is empty, the account URL and account signing secret are used.',
    '',
    '## Shared lead identity fields',
    '',
    'Every lead-scoped email-activity event (`email.sent`, `reply.received`, `reply.categorized`, `bounce.detected`, `unsubscribe.detected`) repeats the same identity block so a CRM can match a contact without a follow-up API call:',
    '',
    '| Field | Notes |',
    '| --- | --- |',
    '| `email` | Lead address for CRM matching. Reply events also keep `from_email`. |',
    '| `mailbox_email` | Sending or receiving inbox. |',
    '| `campaign_name` | Human-readable campaign name. |',
    '| `first_name`, `last_name`, `full_name`, `company_name`, `title`, `website`, `linkedin_url` | Present only when stored on the lead. `title` is promoted from `custom_lead_data`. |',
    '| `custom_fields` | Nested object of `leads.custom_lead_data`. Keys that collide with reserved fields stay nested. |',
    '| `custom_fields_truncated` | `true` only when `custom_fields` exceeded the 8 KB byte budget. |',
    '',
    'Empty or whitespace-only values are omitted. Furnace never sends `""` for these fields. `custom_fields` is capped at **8192 UTF-8 bytes**; overflow keys are dropped and `custom_fields_truncated` is set. `body_text` is capped at **16,000 characters**.',
    '',
    '## No-code tools (Zoho Flow, Zapier, Make)',
    '',
    '1. Create an incoming webhook trigger in your tool and copy its HTTPS URL.',
    '2. Paste the URL in Furnace **Account Settings → Webhooks** and enable **Email activity** (or other groups you need).',
    '3. On the **Test** step, send `email.sent` or `reply.received` and map fields from the sample JSON.',
    '4. No echo-token or custom verification handler is required.',
    '',
    '## Event payloads',
    '',
    'Live JSON examples for every event type:',
    '',
    ...eventLinks,
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
