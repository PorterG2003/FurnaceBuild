import {
  API_KEY_PREFIX,
  BULK_ASYNC_LIMIT,
  BULK_SYNC_LIMIT,
  CLIENT_API_OPENAPI_VERSION,
  CLIENT_API_TITLE,
  CLIENT_API_VERSION,
  DEFAULT_ALLOWED_WEBHOOK_EVENTS,
  DEFAULT_PAGE_SIZE,
  IDEMPOTENCY_TTL_HOURS,
  MAX_ASYNC_JOBS_PER_ACCOUNT,
  MAX_PAGE_SIZE,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
} from './constants.js';
import { buildClientApiPaths } from './paths.js';
import { buildClientApiComponents } from './schemas.js';

const tagDescriptions = [
  {
    name: 'Campaigns',
    description: 'Read and mutate campaigns that belong to the authenticated account.',
  },
  {
    name: 'Leads',
    description: 'Manage campaign leads, including single-row upserts and bulk imports.',
  },
  {
    name: 'Lead fields',
    description: 'Inspect and extend required lead-field mappings derived from the campaign flow.',
  },
  {
    name: 'Jobs',
    description: 'Create and poll asynchronous bulk jobs (import, add/remove, pause/resume).',
  },
  {
    name: 'People',
    description: 'Account-scoped people explorer and profile updates.',
  },
  {
    name: 'Lead lists',
    description: 'Saved lead lists and list membership.',
  },
  {
    name: 'Mailboxes',
    description: 'Read account mailboxes with secret password fields removed.',
  },
  {
    name: 'Inbox',
    description: 'List threads and messages and queue reply jobs.',
  },
  {
    name: 'Block list',
    description: 'List, add, and remove blocked email or domain values.',
  },
  {
    name: 'Stats',
    description: 'Read daily and aggregate campaign performance statistics.',
  },
  {
    name: 'Meta',
    description: 'Service metadata and human-readable documentation endpoints.',
  },
];

function buildDescription() {
  return [
    'Account-scoped REST API for campaigns, leads, people, saved lists, inbox, mailboxes, stats, and block list.',
    '',
    '## Authentication',
    `Send your account API key as \`Authorization: Bearer ${API_KEY_PREFIX}...\`. Keys are created in Furnace Account Settings. Revoked, expired, or unknown keys return \`401 authentication_error\`.`,
    '',
    '## Account Scope',
    'Every `/v1/*` resource is limited to the account that owns the API key. Requests never cross account boundaries.',
    '',
    '## Pagination',
    `List endpoints return \`{ data, limit, offset, total_count }\`. The default page size is ${DEFAULT_PAGE_SIZE} and the maximum is ${MAX_PAGE_SIZE}.`,
    '',
    '## Rate Limits',
    `Successful and error responses include \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, and \`X-RateLimit-Reset\`. Furnace currently allows ${RATE_LIMIT_REQUESTS_PER_MINUTE} requests per account per minute.`,
    '',
    '## Idempotency',
    `Use the \`Idempotency-Key\` header on \`POST /v1/campaigns/{id}/leads\` and \`POST /v1/campaigns/{id}/leads/bulk\` to safely retry imports. Furnace replays the cached response for matching account, route, key, and request-body hash for ${IDEMPOTENCY_TTL_HOURS} hours.`,
    '',
    '## Errors',
    'Errors use a shared `{ error: { type, code, message, param? } }` shape.',
    '',
    '| HTTP | type | Typical causes |',
    '| --- | --- | --- |',
    '| 400 | `invalid_request_error` | Invalid JSON, missing parameters, bad status transitions, missing custom fields |',
    '| 401 | `authentication_error` | Missing, invalid, revoked, or expired API key |',
    '| 403 | `permission_error` | Smartlead campaign mutation, deleted campaign, admin-only operation |',
    '| 404 | `invalid_request_error` | Campaign, lead, mailbox, thread, or import job not found in this account |',
    '| 429 | `rate_limit_error` | Too many requests or too many concurrent async import jobs |',
    '| 500 | `api_error` | Unhandled server-side error |',
    '',
    '## Business Rules',
    `- Smartlead campaigns are read-only through this API.`,
    `- Sync bulk imports accept up to ${BULK_SYNC_LIMIT} leads per request.`,
    `- Async bulk imports accept up to ${BULK_ASYNC_LIMIT} leads per request and allow at most ${MAX_ASYNC_JOBS_PER_ACCOUNT} queued/running jobs per account.`,
    '- When a campaign defines custom lead fields, every key must be present in `custom_lead_data` on create and bulk import requests.',
    '',
    '## Outbound Webhooks',
    `Client API actions can emit webhook events such as ${DEFAULT_ALLOWED_WEBHOOK_EVENTS.join(', ')}. Event delivery is configured in Furnace; this OpenAPI document covers the initiating REST calls and the event types they may trigger.`,
    '',
    '### Atomic vs batch webhooks',
    '- **Atomic tier** — single-lead synchronous requests emit one entity event (`lead.created`, `lead.updated`, `lead.deleted`, campaign status, email activity).',
    '- **Batch tier** — async jobs and sync bulk actions (>1 lead or dedicated bulk endpoints) emit exactly one operation-specific `*.completed` event. Per-row lead webhooks are never emitted during bulk processing.',
    '',
    '### Batch completion payload',
    'Batch completion events use the `BatchCompletionWebhookPayload` schema: `job_id` (null for sync), `source` (`async` | `sync`), `campaign_id`, `operation`, `counts`, and `errors[]`.',
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
    '### Bulk import webhook policy',
    '- Sync bulk (`POST /v1/campaigns/{id}/leads/bulk`) suppresses per-row lead webhooks and emits one `lead.bulk_import.completed` event.',
    '- Async bulk (`POST /v1/campaigns/{id}/leads/bulk/async` or `POST /v1/jobs` with `api_lead_import`) suppresses per-row lead webhooks and emits one `lead.bulk_import.completed` event when the job finishes successfully.',
    '- Poll `GET /v1/jobs/{id}` for per-row errors and aggregate counts in the job `result` payload.',
  ].join('\n');
}

export function buildClientApiOpenApiSpec(baseUrl: string) {
  return {
    openapi: CLIENT_API_OPENAPI_VERSION,
    info: {
      title: CLIENT_API_TITLE,
      version: CLIENT_API_VERSION,
      description: buildDescription(),
    },
    servers: [{ url: baseUrl }],
    tags: tagDescriptions,
    components: buildClientApiComponents(),
    security: [{ bearerAuth: [] }],
    paths: buildClientApiPaths(),
  };
}
