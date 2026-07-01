import {
  expandWebhookSelectionForDisplay,
  formatWebhookEventsSummary as formatWebhookEventsSummaryFromGroups,
  normalizeWebhookSelectionForStorage,
  type WebhookEventType,
  type WebhookEventsSummary,
} from '@/lib/client-api/webhooks/eventGroups';

export type { WebhookEventType, WebhookEventsSummary };

export function parseWebhookEnabledEvents(raw: unknown): WebhookEventType[] {
  return expandWebhookSelectionForDisplay(raw);
}

export function webhookEventsForStorage(selected: readonly WebhookEventType[]): WebhookEventType[] {
  return normalizeWebhookSelectionForStorage(selected);
}

export function formatWebhookEventsSummary(raw: unknown): WebhookEventsSummary {
  return formatWebhookEventsSummaryFromGroups(raw);
}

export const MAX_ACTIVE_API_KEYS = 10;
