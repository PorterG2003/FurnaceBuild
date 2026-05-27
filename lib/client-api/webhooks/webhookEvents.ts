/** Shared webhook event allowlist for UI picker, OpenAPI, and server emitters. */
export const DEFAULT_ALLOWED_WEBHOOK_EVENTS = [
  'lead.created',
  'lead.updated',
  'lead.deleted',
  'lead.bulk_import.completed',
  'lead.added_to_campaign.completed',
  'lead.removed_from_campaign.completed',
  'lead.removed_from_all_campaigns.completed',
  'enrollment.pause_completed',
  'enrollment.resume_completed',
  'campaign.paused',
  'campaign.resumed',
  'campaign.stopped',
  'email.sent',
  'reply.received',
  'bounce.detected',
] as const;

export type WebhookEventType = (typeof DEFAULT_ALLOWED_WEBHOOK_EVENTS)[number];
