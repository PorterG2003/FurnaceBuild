import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeInboxSearchQuery } from '../../inbox/normalizeInboxSearchQuery.js';
import { assertUuid } from '../errors.js';
import { NO_CATEGORY_FILTER, THREAD_CATEGORIES, type ThreadCategory } from './constants.js';

export type InboxSupabase = SupabaseClient;

export interface ListAccountThreadsOptions {
  accountId: string;
  limit: number;
  offset: number;
  campaignId?: string;
  mailboxId?: string;
  unreadOnly?: boolean;
  conversationStatus?: 'open' | 'closed';
  category?: string;
  tagIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  searchQuery?: string;
  hasReplyOnly?: boolean;
  sortBy?: 'open_first' | 'newest' | 'oldest' | 'unread_first';
}

export interface PatchThreadInput {
  category?: string | null;
  conversationStatus?: 'open' | 'closed';
  read?: boolean;
}

type InboxThreadListRow = Record<string, unknown> & {
  total_count?: number;
  search_rank?: number;
};

function stripListMeta(row: InboxThreadListRow): Record<string, unknown> {
  const { total_count: _total, search_rank: _rank, ...thread } = row;
  return thread;
}

export async function listAccountThreads(
  supabase: InboxSupabase,
  options: ListAccountThreadsOptions,
): Promise<{ data: Record<string, unknown>[]; totalCount: number }> {
  const { data, error } = await supabase.rpc('list_account_inbox_threads', {
    p_account_id: options.accountId,
    p_search: normalizeInboxSearchQuery(options.searchQuery),
    p_mailbox_id: options.mailboxId ?? null,
    p_campaign_ids: options.campaignId ? [options.campaignId] : null,
    p_unread_only: options.unreadOnly === true,
    p_date_from: options.dateFrom ?? null,
    p_date_to: options.dateTo ?? null,
    p_tag_ids: options.tagIds?.length ? options.tagIds : null,
    p_category: options.category ?? null,
    p_conversation_status: options.conversationStatus ?? null,
    p_has_reply_only: options.hasReplyOnly !== false,
    p_limit: options.limit,
    p_offset: options.offset,
    p_sort: options.sortBy ?? 'newest',
  });

  if (error) {
    throw new Error(`Failed to list threads: ${error.message}`);
  }

  const rows = (data ?? []) as InboxThreadListRow[];
  return {
    data: rows.map(stripListMeta),
    totalCount: rows[0]?.total_count ?? 0,
  };
}

export async function loadAccountThreadOrThrow(
  supabase: InboxSupabase,
  accountId: string,
  threadId: string,
) {
  assertUuid(threadId, 'id');
  const { data, error } = await supabase
    .from('email_threads')
    .select('*')
    .eq('id', threadId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch thread: ${error.message}`);
  }
  return data;
}

export async function markThreadMessagesRead(
  supabase: InboxSupabase,
  threadId: string,
): Promise<void> {
  const { error } = await supabase
    .from('email_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .eq('direction', 'received')
    .is('read_at', null);
  if (error) {
    throw new Error(`Failed to mark thread as read: ${error.message}`);
  }
}

export async function updateThreadCategory(
  supabase: InboxSupabase,
  threadId: string,
  category: string | null,
): Promise<void> {
  const { data: thread, error: fetchError } = await supabase
    .from('email_threads')
    .select('campaign_id, message_job_id, category')
    .eq('id', threadId)
    .maybeSingle();
  if (fetchError) {
    throw new Error(`Failed to fetch thread: ${fetchError.message}`);
  }

  const previousPositive = thread?.category === 'Interested';
  const nextPositive = category === 'Interested';

  const { error } = await supabase
    .from('email_threads')
    .update({
      category: category ?? null,
      category_source: category ? 'user' : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId);
  if (error) {
    throw new Error(`Failed to update thread category: ${error.message}`);
  }

  if (thread?.campaign_id && thread?.message_job_id) {
    await supabase.rpc('update_replied_event_is_positive', {
      p_campaign_id: thread.campaign_id,
      p_message_job_id: thread.message_job_id,
      p_is_positive: nextPositive,
    });
    const delta = nextPositive === previousPositive ? 0 : nextPositive ? 1 : -1;
    if (delta !== 0) {
      await supabase.rpc('update_campaign_stats_positive_reply', {
        p_campaign_id: thread.campaign_id,
        p_delta: delta,
      });
    }
  }

  if (category && thread?.campaign_id) {
    await supabase.rpc('wake_enrollment_for_thread_category', {
      p_thread_id: threadId,
    });
  }
}

export async function updateThreadConversationStatus(
  supabase: InboxSupabase,
  threadId: string,
  conversationStatus: 'open' | 'closed',
): Promise<void> {
  const { error } = await supabase
    .from('email_threads')
    .update({
      conversation_status: conversationStatus,
      conversation_status_source: 'user',
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId);
  if (error) {
    throw new Error(`Failed to update conversation status: ${error.message}`);
  }
}

export function isValidThreadCategory(value: string | null | undefined): value is ThreadCategory {
  return !!value && (THREAD_CATEGORIES as readonly string[]).includes(value);
}

export async function patchAccountThread(
  supabase: InboxSupabase,
  threadId: string,
  input: PatchThreadInput,
): Promise<void> {
  if (input.category !== undefined) {
    if (input.category !== null && !isValidThreadCategory(input.category)) {
      throw new Error(`Invalid category: ${input.category}`);
    }
    await updateThreadCategory(supabase, threadId, input.category);
  }
  if (input.conversationStatus !== undefined) {
    await updateThreadConversationStatus(supabase, threadId, input.conversationStatus);
  }
  if (input.read === true) {
    await markThreadMessagesRead(supabase, threadId);
  }
}
