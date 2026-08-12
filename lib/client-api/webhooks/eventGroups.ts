import { DEFAULT_ALLOWED_WEBHOOK_EVENTS, type WebhookEventType } from './webhookEvents';

export type { WebhookEventType };

export type WebhookEventGroup = {
  id: string;
  label: string;
  description: string;
  events: readonly WebhookEventType[];
};

export type WebhookGroupSelectionState = 'all' | 'some' | 'none';

export type WebhookEventsSummary =
  | { kind: 'none' }
  | { kind: 'all' }
  | { kind: 'groups'; labels: string[] }
  | { kind: 'events'; events: string[] };

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  'lead.created': 'Lead created',
  'lead.updated': 'Lead updated',
  'lead.deleted': 'Lead deleted',
  'lead.bulk_import.completed': 'Bulk import completed',
  'lead.added_to_campaign.completed': 'Add to campaign completed',
  'lead.removed_from_campaign.completed': 'Remove from campaign completed',
  'lead.removed_from_all_campaigns.completed': 'Remove from all campaigns completed',
  'lead.added_to_list.completed': 'Add to lead list completed',
  'lead.removed_from_list.completed': 'Remove from lead list completed',
  'lead.export.completed': 'Lead export completed',
  'enrollment.pause_completed': 'Enrollment pause completed',
  'enrollment.resume_completed': 'Enrollment resume completed',
  'campaign.paused': 'Campaign paused',
  'campaign.resumed': 'Campaign resumed',
  'campaign.stopped': 'Campaign stopped',
  'email.sent': 'Email sent',
  'reply.received': 'Reply received',
  'reply.categorized': 'Reply categorized',
  'bounce.detected': 'Bounce detected',
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
    id: 'lead_list_and_export',
    label: 'Lead lists / export',
    description: 'Saved-list membership and people export job completions.',
    events: [
      'lead.added_to_list.completed',
      'lead.removed_from_list.completed',
      'lead.export.completed',
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
    description: 'Sends, replies, categorization, and bounces.',
    events: ['email.sent', 'reply.received', 'reply.categorized', 'bounce.detected'],
  },
] as const;

export const ALL_WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = DEFAULT_ALLOWED_WEBHOOK_EVENTS;

export const WEBHOOK_GROUPED_EVENT_ITEMS = WEBHOOK_EVENT_GROUPS.map((group) => ({
  id: group.id,
  label: group.label,
  description: group.description,
  events: group.events.map((type) => ({
    type,
    label: WEBHOOK_EVENT_LABELS[type],
  })),
}));

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

export function expandWebhookSelectionForDisplay(stored: unknown): WebhookEventType[] {
  return expandStoredWebhookEvents(stored);
}

export function normalizeWebhookSelectionForStorage(selected: readonly WebhookEventType[]): WebhookEventType[] {
  const unique = [...new Set(selected)].filter((event) =>
    ALL_WEBHOOK_EVENT_TYPES.includes(event),
  );
  return [...unique].sort();
}

export function groupSelectionState(
  group: WebhookEventGroup,
  selectedEvents: ReadonlySet<WebhookEventType>,
): WebhookGroupSelectionState {
  const selectedInGroup = group.events.filter((event) => selectedEvents.has(event));
  if (selectedInGroup.length === 0) return 'none';
  if (selectedInGroup.length === group.events.length) return 'all';
  return 'some';
}

export function toggleGroupEvents(
  groupId: string,
  selectedEvents: readonly WebhookEventType[],
  selectAll: boolean,
): WebhookEventType[] {
  const group = WEBHOOK_EVENT_GROUPS.find((entry) => entry.id === groupId);
  if (!group) return [...selectedEvents];
  const next = new Set(selectedEvents);
  if (selectAll) {
    for (const event of group.events) next.add(event);
  } else {
    for (const event of group.events) next.delete(event);
  }
  return [...next].sort();
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

export function formatWebhookEventsSummary(stored: unknown): WebhookEventsSummary {
  const events = expandStoredWebhookEvents(stored);
  if (events.length === 0) return { kind: 'none' };
  if (events.length === ALL_WEBHOOK_EVENT_TYPES.length) {
    const allSelected = ALL_WEBHOOK_EVENT_TYPES.every((event) => events.includes(event));
    if (allSelected) return { kind: 'all' };
  }

  const eventSet = new Set(events);
  const fullGroupLabels: string[] = [];
  const mixedLabels: string[] = [];

  for (const group of WEBHOOK_EVENT_GROUPS) {
    const state = groupSelectionState(group, eventSet);
    if (state === 'all') {
      fullGroupLabels.push(group.label);
    } else if (state === 'some') {
      const count = group.events.filter((event) => eventSet.has(event)).length;
      mixedLabels.push(`${group.label} (${count}/${group.events.length})`);
    }
  }

  if (mixedLabels.length > 0) {
    return { kind: 'groups', labels: [...fullGroupLabels, ...mixedLabels] };
  }

  if (fullGroupLabels.length > 0) {
    const covered = new Set(
      WEBHOOK_EVENT_GROUPS
        .filter((group) => fullGroupLabels.includes(group.label))
        .flatMap((group) => group.events),
    );
    if (events.length === covered.size && events.every((event) => covered.has(event))) {
      return { kind: 'groups', labels: fullGroupLabels };
    }
  }

  return {
    kind: 'events',
    events: events.map((event) => WEBHOOK_EVENT_LABELS[event] ?? event),
  };
}

export const WEBHOOK_EVENT_GROUP_SELECT_ITEMS = WEBHOOK_EVENT_GROUPS.map((group) => ({
  value: group.id,
  label: group.label,
  description: group.description,
}));
