/**
 * Type definitions for send worker
 * 
 * Note: These should match Supabase types, but we'll define them here
 * for now to avoid dependency issues. In the future, we could:
 * - Share types via a shared package
 * - Generate types from Supabase schema
 * - Copy types from lib/supabase/types/
 */

export type MessageType = 'campaign' | 'inbox_reply' | 'inbox_forward';

/**
 * True if this job is a campaign send (scheduler-created). False for inbox_reply/inbox_forward.
 * Use this instead of ad-hoc checks so campaign vs manual is defined in one place.
 */
export function isCampaignMessageJob(job: { message_type?: MessageType | null }): boolean {
  const t = job.message_type;
  return t !== 'inbox_reply' && t !== 'inbox_forward';
}

export interface MessageJob {
  id: string;
  enrollment_id: string;
  campaign_id: string;
  lead_id: string;
  mailbox_id: string;
  node_id: string | null;
  message_type?: MessageType;
  status: 'pending' | 'reserved' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'blocked';
  scheduled_at: string;
  reserved_at: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  retry_count: number;
  message_data: {
    node_config?: any;
    variant?: { id?: string; label_snapshot?: string };
    lead_data?: any;
    campaign_data?: any;
    source?: 'inbox_reply' | 'inbox_forward';
    thread_id?: string;
    in_reply_to_message_id?: string;
    forwarded_message_id?: string;
    subject?: string;
    body_text?: string;
    body_html?: string;
    to_email?: string;
    to_name?: string;
    cc?: string[];
    in_reply_to?: string;
    message_references?: string;
    attachments?: Array<{ filename: string; contentType?: string; content: string }>;
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
  deleted_at?: string | null;
  // ... other fields
}

// SQSMessage interface removed - no longer using SQS queue

