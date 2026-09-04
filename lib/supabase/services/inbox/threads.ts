import { supabase } from '../../client';
import type { EmailThread } from '../../types';
import { buildThreadSnippetMap, normalizeInboxSearchQuery } from '@/lib/inbox';
import { getCampaignIdsForTags } from '../campaign-tags';

export type InboxThreadSortBy = 'open_first' | 'newest' | 'oldest' | 'unread_first';

export interface GetThreadsByAccountOptions {
  hasReplyOnly?: boolean;
  limit?: number;
  offset?: number;
  mailboxId?: string;
  campaignId?: string;
  unreadOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
  searchQuery?: string;
  tagIds?: string[];
  /** Threads whose campaign has any of these campaign tags. */
  campaignTagIds?: string[];
  category?: string[];
  includeUnreadCount?: boolean;
  conversationStatus?: 'open' | 'closed' | 'all';
  sortBy?: InboxThreadSortBy;
}

export const NO_CATEGORY_FILTER = '__no_category__';

export type EmailThreadWithUnread = EmailThread & { unread_count: number };

export type GetThreadsByAccountResult = {
  threads: EmailThread[];
  totalCount: number;
};

type InboxThreadListRow = EmailThread & {
  total_count: number;
  search_rank: number;
};

function stripListMeta(row: InboxThreadListRow): EmailThread {
  const { total_count: _total, search_rank: _rank, ...thread } = row;
  return thread;
}

async function resolveCampaignIdsForList(
  accountId: string,
  options?: Pick<GetThreadsByAccountOptions, 'campaignId' | 'campaignTagIds'>,
): Promise<string[] | null> {
  let campaignIdsFromTags: string[] | undefined;
  if (options?.campaignTagIds?.length) {
    campaignIdsFromTags = await getCampaignIdsForTags(accountId, options.campaignTagIds);
    if (campaignIdsFromTags.length === 0) return [];
  }

  if (options?.campaignId) {
    if (campaignIdsFromTags && !campaignIdsFromTags.includes(options.campaignId)) {
      return [];
    }
    return [options.campaignId];
  }

  if (campaignIdsFromTags?.length) {
    return campaignIdsFromTags;
  }

  return null;
}

export async function getThreadsByAccount(
  accountId: string,
  options?: GetThreadsByAccountOptions
): Promise<GetThreadsByAccountResult> {
  const campaignIds = await resolveCampaignIdsForList(accountId, options);
  if (campaignIds && campaignIds.length === 0) {
    return { threads: [], totalCount: 0 };
  }

  const { data, error } = await supabase.rpc('list_account_inbox_threads', {
    p_account_id: accountId,
    p_search: normalizeInboxSearchQuery(options?.searchQuery),
    p_mailbox_id: options?.mailboxId ?? null,
    p_campaign_ids: campaignIds,
    p_unread_only: options?.unreadOnly === true,
    p_date_from: options?.dateFrom ?? null,
    p_date_to: options?.dateTo ?? null,
    p_tag_ids: options?.tagIds?.length ? options.tagIds : null,
    p_category: options?.category?.length ? options.category : null,
    p_conversation_status:
      options?.conversationStatus && options.conversationStatus !== 'all'
        ? options.conversationStatus
        : null,
    p_has_reply_only: options?.hasReplyOnly === true,
    p_limit: options?.limit ?? 50,
    p_offset: options?.offset ?? 0,
    p_sort: options?.sortBy ?? 'newest',
  });

  if (error) throw new Error(`Failed to fetch threads: ${error.message}`);

  const rows = (data ?? []) as InboxThreadListRow[];
  const totalCount = rows[0]?.total_count ?? 0;
  let threads = rows.map(stripListMeta);

  if (options?.includeUnreadCount === true && threads.length > 0) {
    const counts = await getThreadUnreadCounts(threads.map((t) => t.id));
    threads = threads.map((t) => ({ ...t, unread_count: counts[t.id] ?? 0 }));
  }

  return { threads, totalCount };
}

export async function getThreadUnreadCounts(
  threadIds: string[]
): Promise<Record<string, number>> {
  if (threadIds.length === 0) return {};
  const { data, error } = await supabase
    .from('email_messages')
    .select('thread_id')
    .in('thread_id', threadIds)
    .eq('direction', 'received')
    .is('read_at', null);
  if (error) throw new Error(`Failed to fetch unread counts: ${error.message}`);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.thread_id] = (counts[row.thread_id] ?? 0) + 1;
  }
  return counts;
}

export async function getThreadSnippets(
  threadIds: string[]
): Promise<Record<string, string>> {
  if (threadIds.length === 0) return {};
  const { data, error } = await supabase
    .from('email_messages')
    .select('thread_id, direction, body_text, body_html, received_at')
    .in('thread_id', threadIds)
    .eq('direction', 'received')
    .order('received_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(`Failed to fetch thread snippets: ${error.message}`);
  return buildThreadSnippetMap(data ?? []);
}

export async function markThreadMessagesRead(threadId: string): Promise<void> {
  const { error } = await supabase
    .from('email_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .eq('direction', 'received')
    .is('read_at', null);
  if (error) throw new Error(`Failed to mark thread as read: ${error.message}`);
}

export async function getThreadById(threadId: string): Promise<EmailThread | null> {
  const { data, error } = await supabase
    .from('email_threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch thread: ${error.message}`);
  return data ?? null;
}
