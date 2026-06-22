import type { SupabaseClient } from '@supabase/supabase-js';
import { buildInboxInteractionContext, extractSuggestionVersion } from '../../inbox/buildInboxInteractionContext.js';
import type {
  InboxInteractionAction,
  InboxInteractionChange,
  InboxInteractionContext,
  InboxInteractionIntent,
  InboxInteractionSource,
} from '../../inbox/inboxInteractionTypes.js';
import { parseSmartHandlingMetadata } from '../../inbox/smartHandling.js';
import type { AuthenticatedApiKey } from '../auth.js';
import type { Json } from '../../supabase/types/database.js';
import type { Database } from '../../supabase/types/supabase-client-database.js';

type InboxSupabase = SupabaseClient<Database>;
type ThreadRow = Database['public']['Tables']['email_threads']['Row'];
type MessageRow = Database['public']['Tables']['email_messages']['Row'];
type LeadRow = Database['public']['Tables']['leads']['Row'];

export interface RecordClientApiInboxInteractionParams {
  auth: AuthenticatedApiKey;
  thread: ThreadRow;
  triggerMessage?: MessageRow | null;
  action: InboxInteractionAction;
  source: InboxInteractionSource;
  intent?: InboxInteractionIntent | null;
  changes?: InboxInteractionChange[] | null;
}

async function loadLeadContext(
  supabase: InboxSupabase,
  leadId: string | null,
): Promise<LeadRow | null> {
  if (!leadId) return null;
  const { data, error } = await supabase
    .from('leads')
    .select('id, email, first_name, last_name, company_name')
    .eq('id', leadId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load lead for inbox interaction: ${error.message}`);
  }
  return (data as unknown as LeadRow | null) ?? null;
}

async function loadTriggerMessageContext(
  supabase: InboxSupabase,
  threadId: string,
  triggerMessage?: MessageRow | null,
): Promise<MessageRow | null> {
  if (triggerMessage) return triggerMessage;

  const { data, error } = await supabase
    .from('email_messages')
    .select('*')
    .eq('thread_id', threadId)
    .eq('direction', 'received')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load trigger message for inbox interaction: ${error.message}`);
  }
  return (data as MessageRow | null) ?? null;
}

export async function recordClientApiInboxInteraction(
  supabase: InboxSupabase,
  params: RecordClientApiInboxInteractionParams,
): Promise<void> {
  const metadata = parseSmartHandlingMetadata(threadHandlingMetadata(params.thread));
  const [lead, triggerMessage] = await Promise.all([
    loadLeadContext(supabase, params.thread.lead_id),
    loadTriggerMessageContext(supabase, params.thread.id, params.triggerMessage),
  ]);
  const context = buildInboxInteractionContext({
    thread: params.thread,
    lead,
    triggerMessage,
    smartHandlingMetadata: metadata,
  });
  if (!context) return;

  const { suggestion_mode, suggestion_version } = extractSuggestionVersion(metadata);
  const row: Database['public']['Tables']['inbox_interactions']['Insert'] = {
    account_id: params.auth.accountId,
    thread_id: params.thread.id,
    lead_id: params.thread.lead_id,
    trigger_message_id: triggerMessage?.id ?? null,
    classification_completed_at: params.thread.classification_completed_at,
    suggestion_mode,
    suggestion_version,
    actor_type: 'api',
    actor_user_id: null,
    actor_api_key_id: params.auth.id,
    action: params.action,
    source: params.source,
    intent: (params.intent ?? null) as Json | null,
    context: context as unknown as Json,
    changes: (params.changes ?? null) as Json | null,
  };
  const { error } = await supabase.from('inbox_interactions').insert(row);
  if (error) {
    throw new Error(`Failed to record client API inbox interaction: ${error.message}`);
  }
}

function threadHandlingMetadata(thread: ThreadRow): Database['public']['Tables']['email_threads']['Row']['handling_metadata'] {
  return thread.handling_metadata;
}
