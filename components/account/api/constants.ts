import { formFieldSolidInputStyle } from '@/components/ui/forms/formFieldStyles';
import {
  ALL_WEBHOOK_EVENT_TYPES,
  expandStoredWebhookEvents,
  flattenWebhookEventGroups,
  mergeGroupSelectionWithStoredEvents,
  webhookGroupIdsFromStoredEvents,
  WEBHOOK_EVENT_GROUP_SELECT_ITEMS,
  type WebhookEventType,
} from '@/lib/client-api/webhooks/eventGroups';

/** Solid modal field style — prefer `FormTextField` for new UI. */
export const inputStyle = formFieldSolidInputStyle;

export type WebhookEventOption = WebhookEventType;

export const WEBHOOK_EVENT_OPTIONS = ALL_WEBHOOK_EVENT_TYPES;

export function parseWebhookEnabledEvents(raw: unknown): WebhookEventOption[] {
  return expandStoredWebhookEvents(raw);
}

export function parseWebhookGroupIds(raw: unknown): string[] {
  return webhookGroupIdsFromStoredEvents(raw);
}

export function webhookEventsFromGroupIds(groupIds: string[]): WebhookEventOption[] {
  return flattenWebhookEventGroups(groupIds);
}

export function webhookEventsFromGroupsAndLegacy(
  groupIds: string[],
  legacyStored: unknown,
): WebhookEventOption[] {
  return mergeGroupSelectionWithStoredEvents(groupIds, legacyStored);
}

export const WEBHOOK_EVENT_GROUP_ITEMS = WEBHOOK_EVENT_GROUP_SELECT_ITEMS;

/** @deprecated Use WEBHOOK_EVENT_GROUP_ITEMS for grouped picker. */
export const WEBHOOK_EVENT_SELECT_ITEMS = WEBHOOK_EVENT_OPTIONS.map((event) => ({
  value: event,
  label: event,
}));

export const MAX_ACTIVE_API_KEYS = 10;
