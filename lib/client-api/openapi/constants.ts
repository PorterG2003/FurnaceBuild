export const CLIENT_API_OPENAPI_VERSION = '3.1.0';
export const CLIENT_API_TITLE = 'Furnace Client API';
export const CLIENT_API_VERSION = '1.0.0';

export const RATE_LIMIT_REQUESTS_PER_MINUTE = 200;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const BULK_SYNC_LIMIT = 100;
export const BULK_ASYNC_LIMIT = 1000;
export const MAX_ASYNC_JOBS_PER_ACCOUNT = 3;
export const IDEMPOTENCY_TTL_HOURS = 24;
export const API_KEY_PREFIX = 'f_';
export const WEBHOOK_VERIFY_USER_AGENT = 'Furnace-Webhook-Verify/1.0';

export const DEFAULT_ALLOWED_WEBHOOK_EVENTS = [
  'lead.created',
  'lead.updated',
  'lead.deleted',
  'enrollment.created',
  'enrollment.updated',
  'campaign.paused',
  'campaign.resumed',
  'campaign.stopped',
  'email.sent',
  'reply.received',
  'bounce.detected',
] as const;
