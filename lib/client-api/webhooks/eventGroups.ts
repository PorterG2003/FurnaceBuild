import { DEFAULT_ALLOWED_WEBHOOK_EVENTS, type WebhookEventType } from './webhookEvents';

export type { WebhookEventType };

export type WebhookEventGroup = {
  id: string;
  label: string;
  description: string;
  events: readonly WebhookEventType[];
};

export const WEBHOOK_EVENT_GROUPS: readonly WebhookEventGroup[] = [
  {
    id: 'lead_added_updated',
    label: 'Lead added / updated',
    description: 'Single-lead changes and bulk import or add-to-campaign completions.',
    events: [
      'lead.created',
      'lead.updated',
      'lead.bulk_import.completed',
      'lead.added_to_campaign.completed',
    ],
  },
  {
    id: 'lead_removed',
    label: 'Lead removed',
    description: 'Single-lead deletes and bulk removal from one or all campaigns.',
    events: [
      'lead.deleted',
      'lead.removed_from_campaign.completed',
      'lead.removed_from_all_campaigns.completed',
    ],
  },
  {
    id: 'enrollment_pause_resume',
    label: 'Enrollment pause / resume',
    description: 'Manual enrollment holds and bulk pause/resume completions.',
    events: ['enrollment.pause_completed', 'enrollment.resume_completed'],
  },
  {
    id: 'campaign_status',
    label: 'Campaign status',
    description: 'Campaign paused, resumed, or stopped.',
    events: ['campaign.paused', 'campaign.resumed', 'campaign.stopped'],
  },
  {
    id: 'email_activity',
    label: 'Email activity',
    description: 'Sends, replies, and bounces.',
    events: ['email.sent', 'reply.received', 'bounce.detected'],
  },
] as const;

export const ALL_WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = DEFAULT_ALLOWED_WEBHOOK_EVENTS;

export function flattenWebhookEventGroups(groupIds: string[]): WebhookEventType[] {
  const selected = new Set<WebhookEventType>();
  for (const group of WEBHOOK_EVENT_GROUPS) {
    if (groupIds.includes(group.id)) {
      for (const event of group.events) selected.add(event);
    }
  }
  return [...selected].sort();
}

export function expandStoredWebhookEvents(stored: unknown): WebhookEventType[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter((value): value is WebhookEventType =>
    ALL_WEBHOOK_EVENT_TYPES.includes(value as WebhookEventType),
  );
}

export function webhookGroupIdsFromStoredEvents(stored: unknown): string[] {
  const events = new Set(expandStoredWebhookEvents(stored));
  if (events.size === 0) return [];
  return WEBHOOK_EVENT_GROUPS.filter((group) =>
    group.events.every((event) => events.has(event)),
  ).map((group) => group.id);
}

export function mergeGroupSelectionWithStoredEvents(
  selectedGroupIds: string[],
  stored: unknown,
): WebhookEventType[] {
  const fromGroups = flattenWebhookEventGroups(selectedGroupIds);
  const legacy = expandStoredWebhookEvents(stored);
  const merged = new Set<WebhookEventType>([...fromGroups, ...legacy]);
  return [...merged].sort();
}

export const WEBHOOK_EVENT_GROUP_SELECT_ITEMS = WEBHOOK_EVENT_GROUPS.map((group) => ({
  value: group.id,
  label: group.label,
  description: group.description,
}));
