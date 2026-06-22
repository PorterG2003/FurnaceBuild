import { supabase } from '@/lib/supabase/client';
import type { InboxInteractionInsert } from '@/lib/supabase/types';
import type { InboxInteractionPayload } from './inboxInteractionTypes';

export type {
  InboxInteractionAction,
  InboxInteractionChange,
  InboxInteractionContext,
  InboxInteractionIntent,
  InboxInteractionLeadContext,
  InboxInteractionPayload,
  InboxInteractionSource,
  InboxInteractionThreadContext,
  InboxInteractionTriggerMessageContext,
} from './inboxInteractionTypes';

export async function recordInboxInteraction(payload: InboxInteractionPayload): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) {
    throw new Error(`Failed to resolve user for inbox interaction: ${userErr.message}`);
  }

  const userId = userData.user?.id;
  if (!userId) {
    throw new Error('Failed to resolve user for inbox interaction: missing authenticated user.');
  }

  const row: InboxInteractionInsert = {
    account_id: payload.account_id,
    thread_id: payload.thread_id,
    lead_id: payload.lead_id ?? null,
    trigger_message_id: payload.trigger_message_id ?? null,
    classification_completed_at: payload.classification_completed_at ?? null,
    suggestion_mode: payload.suggestion_mode ?? null,
    suggestion_version: payload.suggestion_version ?? null,
    actor_type: 'user',
    actor_user_id: userId,
    actor_api_key_id: null,
    action: payload.action,
    source: payload.source,
    intent: (payload.intent ?? null) as InboxInteractionInsert['intent'],
    context: payload.context as InboxInteractionInsert['context'],
    changes: (payload.changes ?? null) as InboxInteractionInsert['changes'],
  };

  const { error } = await supabase.from('inbox_interactions').insert(row);
  if (error) {
    throw new Error(`Failed to record inbox interaction: ${error.message}`);
  }
}
