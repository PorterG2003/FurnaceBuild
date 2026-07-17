export const CLIENT_API_OPENAPI_VERSION = '3.1.0';
export const CLIENT_API_TITLE = 'Furnace Client API';
export const CLIENT_API_VERSION = '1.6.0';

export const RATE_LIMIT_REQUESTS_PER_MINUTE = 200;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const BULK_SYNC_LIMIT = 100;
export const BULK_ASYNC_LIMIT = 1000;
export const MAX_ASYNC_JOBS_PER_ACCOUNT = 3;
export const IDEMPOTENCY_TTL_HOURS = 24;
export const API_KEY_PREFIX = 'f_';

export const IMPORT_JOB_OPERATIONS = [
  'api_lead_import',
  'add_to_campaign',
  'remove_from_campaign',
  'remove_from_all_campaigns',
  'pause_enrollments',
  'resume_enrollments',
] as const;

export type ImportJobOperationConstant = (typeof IMPORT_JOB_OPERATIONS)[number];

export { DEFAULT_ALLOWED_WEBHOOK_EVENTS } from '../webhooks/webhookEvents.js';
export type { WebhookEventType } from '../webhooks/webhookEvents.js';
