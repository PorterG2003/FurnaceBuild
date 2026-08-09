/**
 * Type definitions for send worker
 * 
 * Note: These should match Supabase types, but we'll define them here
 * for now to avoid dependency issues. In the future, we could:
 * - Share types via a shared package
 * - Generate types from Supabase schema
 * - Copy types from lib/supabase/types/
 */

export type MessageType =
  | 'campaign'
  | 'campaign_priority'
  | 'campaign_reply' // legacy alias during compatibility window
  | 'inbox_reply'
  | 'inbox_forward';

/**
 * True if this job is a campaign outbound send. False for inbox_reply/inbox_forward.
 * campaign_priority (and legacy campaign_reply) count as campaign jobs
 * (enrollment-driven, campaign stats/events).
 * Must stay aligned with SQL public.is_campaign_outbound_message_type.
 */
export function isCampaignMessageJob(job: { message_type?: MessageType | null }): boolean {
  const t = job.message_type;
  return t !== 'inbox_reply' && t !== 'inbox_forward';
}

/**
 * Scheduler-paced campaign sends only (not priority lane).
 * Must stay aligned with SQL public.is_paced_campaign_message_type.
 */
export function isPacedCampaignMessageJob(job: { message_type?: MessageType | null }): boolean {
  const t = job.message_type;
  return t == null || t === 'campaign';
}

/**
 * Priority-lane campaign jobs (immediate, skip pacing). Accepts both the new
 * campaign_priority value and the legacy campaign_reply alias.
 */
export function isPriorityCampaignJob(job: { message_type?: MessageType | null }): boolean {
  const t = job.message_type;
  return t === 'campaign_priority' || t === 'campaign_reply';
}

export interface MessageJob {
  id: string;
  enrollment_id: string;
  campaign_id: string;
  lead_id: string;
  mailbox_id: string;
  node_id: string | null;
  message_type?: MessageType;
  status: 'queued' | 'reserved' | 'sending' | 'sent' | 'deferred' | 'failed' | 'cancelled' | 'blocked' | 'held';
  status_reason?: string | null;
  scheduled_at: string;
  reserved_at: string | null;
  lease_expires_at?: string | null;
  claim_token?: string | null;
  sending_started_at?: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  submitted_message_id?: string | null;
  error_message: string | null;
  retry_count: number;
  message_data: {
    node_config?: any;
    variant?: { id?: string; label_snapshot?: string };
    lead_data?: any;
    campaign_data?: any;
    source?: 'inbox_reply' | 'inbox_forward' | 'campaign_priority' | 'campaign_reply';
    thread_id?: string;
    in_reply_to_message_id?: string;
    forwarded_message_id?: string;
    subject?: string;
    /** Exact subject line used on a successful send (for follow-up thread continuity). */
    sent_subject?: string;
    body_text?: string;
    body_html?: string;
    to_email?: string;
    to_name?: string;
    cc?: string[];
    in_reply_to?: string;
    message_references?: string;
    reference_message_ids?: string[];
    thread_topic?: string;
    submitted_message_id?: string;
    /** Why this send threaded the way it did, for incident triage. */
    threading_decision?: 'root' | 'continue-epoch' | 'new-epoch' | 'explicit-parent';
    /** email_messages.id of the parent, when the parent was a stored row. */
    parent_email_message_id?: string;
    /** Wire Message-ID of the first message in this send's subject epoch. */
    conversation_root_message_id?: string;
    attachments?: Array<{ filename: string; contentType?: string; content: string }>;
    /** Test harness flag: skip SMTP and still finalize as sent. */
    skip_smtp?: boolean;
  };
  sqs_message_id: string | null;
  created_at: string;
  updated_at: string;
  /** Chosen A/B variant UUID at job creation (matches flow_data variants[].id). */
  variant_id?: string | null;
}

export interface Mailbox {
  id: string;
  email_address: string;
  display_name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string; // Will be decrypted if encrypted
  smtp_use_tls: boolean;
  smtp_use_ssl: boolean;
  smtp_status: 'active' | 'throttled' | 'error' | 'disabled';
  smtp_connection_limit?: number;
  smtp_messages_per_connection?: number;
  signature?: string | null;
  deleted_at?: string | null;
  // ... other fields
}

export interface Lead {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  mailbox_id?: string | null;
  deleted_at?: string | null;
  // ... other fields
}

// SQSMessage interface removed - no longer using SQS queue

