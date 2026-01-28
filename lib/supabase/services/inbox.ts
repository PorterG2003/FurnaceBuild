import { supabase } from '../client';
import type { EmailThread, EmailMessage } from '../types';

/**
 * List email threads for an account.
 * Ordered by last_message_at descending (newest first).
 * Optionally filter to threads that have at least one reply (has_reply = true).
 */
export async function getThreadsByAccount(
  accountId: string,
  options?: { hasReplyOnly?: boolean; limit?: number }
): Promise<EmailThread[]> {
  let query = supabase
    .from('email_threads')
    .select('*')
    .eq('account_id', accountId)
    .order('last_message_at', { ascending: false });

  if (options?.hasReplyOnly === true) {
    query = query.eq('has_reply', true);
  }

  if (options?.limit != null && options.limit > 0) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch threads: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Get a single thread by ID (for current-account checks or detail).
 */
export async function getThreadById(threadId: string): Promise<EmailThread | null> {
  const { data, error } = await supabase
    .from('email_threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch thread: ${error.message}`);
  }

  return data ?? null;
}

/**
 * List messages in a thread, ordered by received_at ascending (chronological).
 */
export async function getMessagesByThread(threadId: string): Promise<EmailMessage[]> {
  const { data, error } = await supabase
    .from('email_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('received_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  return data ?? [];
}
