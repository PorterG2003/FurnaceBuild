export const CLIENT_API_OPENAPI_VERSION = '3.1.0';
export const CLIENT_API_TITLE = 'Furnace Client API';
export const CLIENT_API_VERSION = '1.11.0';

export const RATE_LIMIT_REQUESTS_PER_MINUTE = 200;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const BULK_SYNC_LIMIT = 100;
export const BULK_ASYNC_LIMIT = 1000;
/** Concurrent *running* jobs claimed by workers per account. */
export const MAX_ASYNC_JOBS_PER_ACCOUNT = 3;
/** Additional jobs allowed in `queued` status while waiting for a running slot. */
export const MAX_QUEUED_ASYNC_JOBS_PER_ACCOUNT = 25;
/** Max lead rows per staged-import append call. */
export const STAGED_IMPORT_APPEND_LIMIT = 500;
/** Max explicit email/id exclusions on a single bulk request. */
export const BULK_EXPLICIT_EXCLUSION_LIMIT = 5000;
export const IDEMPOTENCY_TTL_HOURS = 24;
export const API_KEY_PREFIX = 'f_';

export const IMPORT_JOB_OPERATIONS = [
  'api_lead_import',
  'add_to_campaign',
  'remove_from_campaign',
  'remove_from_all_campaigns',
  'pause_enrollments',
  'resume_enrollments',
  'add_to_lead_list',
  'remove_from_lead_list',
  'export_leads',
  'csv_lead_import_staged',
] as const;

export type ImportJobOperationConstant = (typeof IMPORT_JOB_OPERATIONS)[number];

export { DEFAULT_ALLOWED_WEBHOOK_EVENTS } from '../webhooks/webhookEvents.js';
export type { WebhookEventType } from '../webhooks/webhookEvents.js';
