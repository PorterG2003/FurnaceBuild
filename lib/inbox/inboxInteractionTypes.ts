export type InboxInteractionSource =
  | 'smart_handling_bar'
  | 'message_menu'
  | 'category_picker'
  | 'ooo_modal'
  | 'replace_lead_flow'
  | 'composer'
  | 'thread_header'
  | 'block_modal'
  | 'client_api';

export type InboxInteractionAction =
  | 'thread.set_category'
  | 'thread.dismiss_suggestion'
  | 'thread.close_conversation'
  | 'thread.reopen_conversation'
  | 'thread.mark_ooo_dated'
  | 'thread.mark_ooo_month'
  | 'thread.mark_ooo_instant'
  | 'thread.mark_ooo_custom'
  | 'thread.mark_out_of_office'
  | 'thread.mark_not_interested'
  | 'thread.mark_not_interested_block'
  | 'thread.block_sender'
  | 'thread.mark_neutral'
  | 'thread.mark_interested'
  | 'thread.mark_interested_reply'
  | 'thread.reply_only'
  | 'thread.replace_lead'
  | 'thread.reply_sent'
  | 'thread.forward_sent'
  | 'lead.replaced';

export interface InboxInteractionLeadContext {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
}

export interface InboxInteractionTriggerMessageContext {
  id: string;
  subject: string;
  from_email: string;
  from_name: string | null;
  body_preview: string | null;
}

export interface InboxInteractionThreadContext {
  id: string;
  account_id: string;
  campaign_id: string | null;
  lead_id: string | null;
  category: string | null;
  category_source: string | null;
  conversation_status: string;
  conversation_status_source: string;
  classification_status: string;
  classification_completed_at: string | null;
  handling_metadata: Record<string, unknown> | null;
  out_of_office: boolean;
  ooo_resume_requested: boolean;
  ooo_resume_at: string | null;
  ooo_resume_processed_at: string | null;
}

export interface InboxInteractionContext {
  thread: InboxInteractionThreadContext;
  lead: InboxInteractionLeadContext | null;
  trigger_message: InboxInteractionTriggerMessageContext | null;
}

export interface InboxInteractionChange {
  field: string;
  from?: unknown;
  to?: unknown;
}

export interface InboxInteractionIntent {
  action_id?: string | null;
  suggested_primary?: string | null;
  suggested_category?: string | null;
  matched_suggestion?: boolean | null;
  used_suggested_reply?: boolean | null;
  suggestion_version?: string | null;
}

export interface InboxInteractionPayload {
  account_id: string;
  thread_id: string;
  lead_id?: string | null;
  trigger_message_id?: string | null;
  classification_completed_at?: string | null;
  suggestion_mode?: 'manual' | 'ai' | null;
  suggestion_version?: string | null;
  action: InboxInteractionAction;
  source: InboxInteractionSource;
  intent?: InboxInteractionIntent | null;
  context: InboxInteractionContext;
  changes?: InboxInteractionChange[] | null;
}
