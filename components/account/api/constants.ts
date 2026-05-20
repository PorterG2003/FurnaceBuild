import { formFieldSolidInputStyle } from '@/components/ui/forms/formFieldStyles';

/** Solid modal field style — prefer `FormTextField` for new UI. */
export const inputStyle = formFieldSolidInputStyle;

export const WEBHOOK_EVENT_OPTIONS = [
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

export type WebhookEventOption = (typeof WEBHOOK_EVENT_OPTIONS)[number];

export function parseWebhookEnabledEvents(raw: unknown): WebhookEventOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is WebhookEventOption =>
    WEBHOOK_EVENT_OPTIONS.includes(value as WebhookEventOption)
  );
}

export const WEBHOOK_EVENT_SELECT_ITEMS = WEBHOOK_EVENT_OPTIONS.map((event) => ({
  value: event,
  label: event,
}));

export const MAX_ACTIVE_API_KEYS = 10;
