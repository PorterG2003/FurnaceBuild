import { supabase } from '../../client';
import {
  loadOpenConversationCountsByAccountIds,
  OPEN_CONVERSATION_COUNT_FILTERS,
} from './openConversationCounts-core';

export { loadOpenConversationCountsByAccountIds, OPEN_CONVERSATION_COUNT_FILTERS };

export async function getOpenConversationCount(accountId: string): Promise<number> {
  const { count, error } = await supabase
    .from('email_threads')
    .select(OPEN_CONVERSATION_COUNT_FILTERS.countColumn, { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('conversation_status', OPEN_CONVERSATION_COUNT_FILTERS.conversationStatus);

  if (error) throw new Error(`Failed to count open conversations: ${error.message}`);
  return count ?? 0;
}

export async function getOpenConversationCountsByAccountIds(
  accountIds: string[],
): Promise<Record<string, number>> {
  return loadOpenConversationCountsByAccountIds(accountIds, getOpenConversationCount);
}
