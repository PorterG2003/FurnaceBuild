import { supabase } from '../../client';
import type { EmailThread } from '../../types';
import { getDisplayBody } from '@/lib/email/index';

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
  category?: string;
  includeUnreadCount?: boolean;
}

export const NO_CATEGORY_FILTER = '__no_category__';

export type EmailThreadWithUnread = EmailThread & { unread_count: number };

export async function getThreadsByAccount(
  accountId: string,
  options?: GetThreadsByAccountOptions
): Promise<EmailThread[]> {
  if (options?.unreadOnly === true) {
    const { data: unreadThreadIds } = await supabase
      .from('email_messages')
      .select('thread_id')
      .eq('direction', 'received')
      .is('read_at', null);
    const threadIds = [...new Set((unreadThreadIds ?? []).map((r) => r.thread_id))];
    if (threadIds.length === 0) return [];
    const { data: threadsWithUnread } = await supabase
      .from('email_threads')
      .select('id')
      .eq('account_id', accountId)
      .in('id', threadIds);
    const ids = (threadsWithUnread ?? []).map((t) => t.id);
    if (ids.length === 0) return [];
    return getThreadsByAccountInternal(accountId, { ...options, restrictToThreadIds: ids });
  }
  return getThreadsByAccountInternal(accountId, options);
}

async function getThreadsByAccountInternal(
  accountId: string,
  options?: GetThreadsByAccountOptions & { restrictToThreadIds?: string[] }
): Promise<EmailThread[]> {
  let query = supabase
    .from('email_threads')
    .select('*')
    .eq('account_id', accountId)
    .order('last_message_at', { ascending: false });

  if (options?.hasReplyOnly === true) query = query.eq('has_reply', true);
  if (options?.mailboxId) query = query.eq('mailbox_id', options.mailboxId);
  if (options?.campaignId) query = query.eq('campaign_id', options.campaignId);
  if (options?.dateFrom) query = query.gte('last_message_at', options.dateFrom);
  if (options?.dateTo) query = query.lte('last_message_at', options.dateTo);
  if (options?.searchQuery?.trim()) {
    const q = options.searchQuery.trim();
    const pattern = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    query = query.ilike('subject', pattern);
  }
  if (options?.category === NO_CATEGORY_FILTER) query = query.is('category', null);
  else if (options?.category) query = query.eq('category', options.category);
  if (options?.tagIds?.length) {
    const { data: assigned } = await supabase
      .from('thread_tag_assignments')
      .select('thread_id')
      .in('tag_id', options.tagIds);
    const tagThreadIds = [...new Set((assigned ?? []).map((r) => r.thread_id))];
    if (tagThreadIds.length === 0) return [];
    const idsToRestrict = options.restrictToThreadIds
      ? tagThreadIds.filter((id) => options.restrictToThreadIds!.includes(id))
      : tagThreadIds;
    if (idsToRestrict.length === 0) return [];
    query = query.in('id', idsToRestrict);
  }
  if (options?.restrictToThreadIds?.length && !options?.tagIds?.length) {
    query = query.in('id', options.restrictToThreadIds);
  }
  const limit = options?.limit;
  const offset = options?.offset ?? 0;
  if (limit != null && limit > 0) query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch threads: ${error.message}`);
  const list = (data ?? []) as EmailThread[];

  if (options?.includeUnreadCount === true && list.length > 0) {
    const counts = await getThreadUnreadCounts(list.map((t) => t.id));
    return list.map((t) => ({ ...t, unread_count: counts[t.id] ?? 0 }));
  }
  return list;
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

const SNIPPET_MAX_LENGTH = 100;

export async function getThreadSnippets(
  threadIds: string[]
): Promise<Record<string, string>> {
  if (threadIds.length === 0) return {};
  const { data, error } = await supabase
    .from('email_messages')
    .select('thread_id, body_text, body_html, received_at')
    .in('thread_id', threadIds)
    .order('received_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(`Failed to fetch thread snippets: ${error.message}`);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.thread_id in map) continue;
    const hasText = row.body_text != null && row.body_text.trim().length > 0;
    const body = hasText ? row.body_text! : (row.body_html ?? '');
    const display = getDisplayBody(body, { format: hasText ? 'text' : 'html' });
    const oneline = display.replace(/\s+/g, ' ').trim();
    map[row.thread_id] = oneline.slice(0, SNIPPET_MAX_LENGTH);
  }
  return map;
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
