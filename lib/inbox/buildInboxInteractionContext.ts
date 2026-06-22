import { stripHtml } from '../email/parse-body';
import type { Database } from '../supabase/types/database';
import type {
  InboxInteractionContext,
  InboxInteractionLeadContext,
  InboxInteractionTriggerMessageContext,
  InboxInteractionThreadContext,
} from './inboxInteractionTypes';

type EmailMessage = Database['public']['Tables']['email_messages']['Row'];
type EmailThread = Database['public']['Tables']['email_threads']['Row'];
type Lead = Database['public']['Tables']['leads']['Row'];
import type { SmartHandlingMetadata, SmartHandlingMode } from './smartHandling';

export interface BuildInboxInteractionContextParams {
  thread: EmailThread | null | undefined;
  lead?: Lead | null;
  triggerMessage?: EmailMessage | null;
  smartHandlingMetadata?: SmartHandlingMetadata | null;
}

function trimPreview(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

function buildTriggerMessageContext(message: EmailMessage | null | undefined): InboxInteractionTriggerMessageContext | null {
  if (!message) return null;

  return {
    id: message.id,
    subject: message.subject,
    from_email: message.from_email,
    from_name: message.from_name,
    body_preview: trimPreview(message.body_text?.trim() || stripHtml(message.body_html)),
  };
}

function buildLeadContext(lead: Lead | null | undefined): InboxInteractionLeadContext | null {
  if (!lead) return null;
  return {
    id: lead.id,
    email: lead.email,
    first_name: lead.first_name,
    last_name: lead.last_name,
    company_name: lead.company_name,
  };
}

function buildThreadContext(thread: EmailThread): InboxInteractionThreadContext {
  return {
    id: thread.id,
    account_id: thread.account_id,
    campaign_id: thread.campaign_id,
    lead_id: thread.lead_id,
    category: thread.category,
    category_source: thread.category_source,
    conversation_status: thread.conversation_status,
    conversation_status_source: thread.conversation_status_source,
    classification_status: thread.classification_status,
    classification_completed_at: thread.classification_completed_at,
    handling_metadata:
      thread.handling_metadata && typeof thread.handling_metadata === 'object' && !Array.isArray(thread.handling_metadata)
        ? (thread.handling_metadata as Record<string, unknown>)
        : null,
    out_of_office: thread.out_of_office,
    ooo_resume_requested: thread.ooo_resume_requested,
    ooo_resume_at: thread.ooo_resume_at,
    ooo_resume_processed_at: thread.ooo_resume_processed_at,
  };
}

export function extractSuggestionVersion(
  metadata: SmartHandlingMetadata | null | undefined,
): { suggestion_mode: SmartHandlingMode | null; suggestion_version: string | null } {
  return {
    suggestion_mode: metadata?.mode ?? null,
    suggestion_version: metadata?.suggestion_version ?? null,
  };
}

export function buildInboxInteractionContext(
  params: BuildInboxInteractionContextParams,
): InboxInteractionContext | null {
  if (!params.thread) return null;

  return {
    thread: buildThreadContext(params.thread),
    lead: buildLeadContext(params.lead),
    trigger_message: buildTriggerMessageContext(params.triggerMessage),
  };
}
