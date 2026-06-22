import type { SupabaseClient } from '@supabase/supabase-js';
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
}

export interface PatchThreadInput {
  category?: string | null;
  conversationStatus?: 'open' | 'closed';
  read?: boolean;
}

function escapeIlikePattern(value: string): string {
  return `%${value.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
}

async function resolveUnreadThreadIds(
  supabase: InboxSupabase,
  accountId: string,
): Promise<string[]> {
  const { data: unreadRows, error } = await supabase
    .from('email_messages')
    .select('thread_id')
    .eq('direction', 'received')
    .is('read_at', null);
  if (error) {
    throw new Error(`Failed to fetch unread messages: ${error.message}`);
  }
  const threadIds = [...new Set((unreadRows ?? []).map((row) => row.thread_id))];
  if (threadIds.length === 0) return [];
  const { data: accountThreads, error: threadError } = await supabase
    .from('email_threads')
    .select('id')
    .eq('account_id', accountId)
    .in('id', threadIds);
  if (threadError) {
    throw new Error(`Failed to filter unread threads: ${threadError.message}`);
  }
  return (accountThreads ?? []).map((row) => row.id);
}

async function resolveTagThreadIds(
  supabase: InboxSupabase,
  tagIds: string[],
): Promise<string[]> {
  const { data: assigned, error } = await supabase
    .from('thread_tag_assignments')
    .select('thread_id')
    .in('tag_id', tagIds);
  if (error) {
    throw new Error(`Failed to fetch thread tag assignments: ${error.message}`);
  }
  return [...new Set((assigned ?? []).map((row) => row.thread_id))];
}

function intersectIds(left: string[] | undefined, right: string[]): string[] {
  if (!left) return right;
  const rightSet = new Set(right);
  return left.filter((id) => rightSet.has(id));
}

export async function listAccountThreads(
  supabase: InboxSupabase,
  options: ListAccountThreadsOptions,
): Promise<{ data: Record<string, unknown>[]; totalCount: number }> {
  let restrictToThreadIds: string[] | undefined;

  if (options.unreadOnly) {
    restrictToThreadIds = await resolveUnreadThreadIds(supabase, options.accountId);
    if (restrictToThreadIds.length === 0) {
      return { data: [], totalCount: 0 };
    }
  }

  if (options.tagIds?.length) {
    const tagThreadIds = await resolveTagThreadIds(supabase, options.tagIds);
    if (tagThreadIds.length === 0) {
      return { data: [], totalCount: 0 };
    }
    restrictToThreadIds = intersectIds(restrictToThreadIds, tagThreadIds);
    if (restrictToThreadIds.length === 0) {
      return { data: [], totalCount: 0 };
    }
  }

  let query = supabase
    .from('email_threads')
    .select('*', { count: 'exact' })
    .eq('account_id', options.accountId)
    .order('conversation_status', { ascending: false })
    .order('last_message_at', { ascending: false });

  if (options.hasReplyOnly !== false) {
    query = query.eq('has_reply', true);
  }
  if (options.mailboxId) query = query.eq('mailbox_id', options.mailboxId);
  if (options.campaignId) query = query.eq('campaign_id', options.campaignId);
  if (options.conversationStatus) {
    query = query.eq('conversation_status', options.conversationStatus);
  }
  if (options.dateFrom) query = query.gte('last_message_at', options.dateFrom);
  if (options.dateTo) query = query.lte('last_message_at', options.dateTo);
  if (options.searchQuery?.trim()) {
    query = query.ilike('subject', escapeIlikePattern(options.searchQuery.trim()));
  }
  if (options.category === NO_CATEGORY_FILTER) {
    query = query.is('category', null);
  } else if (options.category) {
    query = query.eq('category', options.category);
  }
  if (restrictToThreadIds?.length) {
    query = query.in('id', restrictToThreadIds);
  }

  const { data, error, count } = await query.range(options.offset, options.offset + options.limit - 1);
  if (error) {
    throw new Error(`Failed to list threads: ${error.message}`);
  }
  return {
    data: (data ?? []) as Record<string, unknown>[],
    totalCount: count ?? 0,
  };
}

export async function loadAccountThreadOrThrow(
  supabase: InboxSupabase,
  accountId: string,
  threadId: string,
) {
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
