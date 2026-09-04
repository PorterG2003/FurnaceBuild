import type { InboxThreadSortBy } from './threads';

export type InboxDefaultFilterSnapshot = {
  mailboxFilterId: string | null;
  campaignFilterId: string | null;
  unreadOnlyFilter: boolean;
  datePreset: '7d' | '30d' | null;
  tagFilterIds: string[];
  campaignTagFilterIds: string[];
  categoryFilter: string[];
  conversationStatusFilter: 'open' | 'closed' | 'all';
  sortBy: InboxThreadSortBy;
};

const SORT_BY_VALUES: readonly InboxThreadSortBy[] = [
  'open_first',
  'newest',
  'oldest',
  'unread_first',
];
const DATE_PRESETS = ['7d', '30d'] as const;
const CONVERSATION_STATUSES = ['open', 'closed', 'all'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (!isNonEmptyString(item)) return null;
    ids.push(item);
  }
  return ids;
}

function parseNullableId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (isNonEmptyString(value)) return value;
  return undefined;
}

/** Accepts current `string[]` and legacy scalar/`null` saved defaults. */
function parseCategoryFilter(value: unknown): string[] | null {
  if (value === null) return [];
  if (isNonEmptyString(value)) return [value];
  return parseIdList(value);
}

export function parseInboxDefaultFilter(value: unknown): InboxDefaultFilterSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const mailboxFilterId = parseNullableId(raw.mailboxFilterId);
  const campaignFilterId = parseNullableId(raw.campaignFilterId);
  const categoryFilter = parseCategoryFilter(raw.categoryFilter);
  if (mailboxFilterId === undefined || campaignFilterId === undefined || categoryFilter === null) {
    return null;
  }

  if (typeof raw.unreadOnlyFilter !== 'boolean') return null;

  const datePreset =
    raw.datePreset === null
      ? null
      : DATE_PRESETS.includes(raw.datePreset as (typeof DATE_PRESETS)[number])
        ? (raw.datePreset as '7d' | '30d')
        : undefined;
  if (datePreset === undefined) return null;

  const tagFilterIds = parseIdList(raw.tagFilterIds);
  const campaignTagFilterIds = parseIdList(raw.campaignTagFilterIds);
  if (!tagFilterIds || !campaignTagFilterIds) return null;

  if (
    !CONVERSATION_STATUSES.includes(
      raw.conversationStatusFilter as (typeof CONVERSATION_STATUSES)[number],
    )
  ) {
    return null;
  }

  if (!SORT_BY_VALUES.includes(raw.sortBy as InboxThreadSortBy)) return null;

  return {
    mailboxFilterId,
    campaignFilterId,
    unreadOnlyFilter: raw.unreadOnlyFilter,
    datePreset,
    tagFilterIds,
    campaignTagFilterIds,
    categoryFilter,
    conversationStatusFilter: raw.conversationStatusFilter as 'open' | 'closed' | 'all',
    sortBy: raw.sortBy as InboxThreadSortBy,
  };
}

export function toInboxFilterSnapshot(input: InboxDefaultFilterSnapshot): InboxDefaultFilterSnapshot {
  return {
    mailboxFilterId: input.mailboxFilterId,
    campaignFilterId: input.campaignFilterId,
    unreadOnlyFilter: input.unreadOnlyFilter,
    datePreset: input.datePreset,
    tagFilterIds: [...input.tagFilterIds],
    campaignTagFilterIds: [...input.campaignTagFilterIds],
    categoryFilter: [...input.categoryFilter],
    conversationStatusFilter: input.conversationStatusFilter,
    sortBy: input.sortBy,
  };
}

function sortedCopy(ids: string[]): string[] {
  return [...ids].sort();
}

export function inboxFiltersEqual(
  a: InboxDefaultFilterSnapshot,
  b: InboxDefaultFilterSnapshot,
): boolean {
  return (
    a.mailboxFilterId === b.mailboxFilterId &&
    a.campaignFilterId === b.campaignFilterId &&
    a.unreadOnlyFilter === b.unreadOnlyFilter &&
    a.datePreset === b.datePreset &&
    a.conversationStatusFilter === b.conversationStatusFilter &&
    a.sortBy === b.sortBy &&
    sortedCopy(a.categoryFilter).join('\0') === sortedCopy(b.categoryFilter).join('\0') &&
    sortedCopy(a.tagFilterIds).join('\0') === sortedCopy(b.tagFilterIds).join('\0') &&
    sortedCopy(a.campaignTagFilterIds).join('\0') === sortedCopy(b.campaignTagFilterIds).join('\0')
  );
}
