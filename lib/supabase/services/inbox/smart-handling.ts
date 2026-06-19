import { supabase } from '../../client';

export type ConversationStatus = 'open' | 'closed';
export type ConversationStatusSource = 'user' | 'system';

export async function updateConversationStatus(
  threadId: string,
  conversationStatus: ConversationStatus,
  conversationStatusSource: ConversationStatusSource = 'user',
): Promise<void> {
  const { error } = await supabase
    .from('email_threads')
    .update({
      conversation_status: conversationStatus,
      conversation_status_source: conversationStatusSource,
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId);

  if (error) {
    throw new Error(`Failed to update conversation status: ${error.message}`);
  }
}

export async function closeConversation(
  threadId: string,
  source: ConversationStatusSource = 'user',
): Promise<void> {
  await updateConversationStatus(threadId, 'closed', source);
}

export async function reopenConversation(
  threadId: string,
  source: ConversationStatusSource = 'system',
): Promise<void> {
  await updateConversationStatus(threadId, 'open', source);
}
