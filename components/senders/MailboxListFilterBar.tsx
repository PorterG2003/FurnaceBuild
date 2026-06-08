import type { MailboxOverview } from '@/lib/supabase/services/mailboxes';
import type { MailboxTag } from '@/lib/supabase/services/mailbox-tags';

export interface MailboxListFilters {
  tagIds: string[];
}

export const EMPTY_MAILBOX_LIST_FILTERS: MailboxListFilters = {
  tagIds: [],
};

export function countActiveMailboxListFilters(filters: MailboxListFilters): number {
  return filters.tagIds.length > 0 ? 1 : 0;
}

export function filterMailboxes(
  mailboxes: MailboxOverview[],
  searchQuery: string,
  filters: MailboxListFilters,
  mailboxTagsMap: Record<string, MailboxTag[]>,
): MailboxOverview[] {
  const search = searchQuery.trim().toLowerCase();
  return mailboxes.filter((mailbox) => {
    if (search) {
      const displayName = (mailbox.display_name ?? '').toLowerCase();
      const emailAddress = mailbox.email_address.toLowerCase();
      if (!displayName.includes(search) && !emailAddress.includes(search)) return false;
    }

    if (filters.tagIds.length > 0) {
      const mailboxTagIds = new Set((mailboxTagsMap[mailbox.id] ?? []).map((tag) => tag.id));
      const hasAny = filters.tagIds.some((id) => mailboxTagIds.has(id));
      if (!hasAny) return false;
    }

    return true;
  });
}
