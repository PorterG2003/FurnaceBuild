/**
 * Type definitions for inbox checker worker
 */

export interface Mailbox {
  id: string;
  account_id: string;
  user_id: string;
  email_address: string;
  display_name: string | null;
  provider: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  smtp_use_ssl: boolean;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
  status: 'connected' | 'disconnected' | 'error';
  last_synced_at: string | null;
  error_message: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessedMessage {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  from: { name?: string; address: string };
  to: Array<{ name?: string; address: string }>;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  date: Date;
  headers: Record<string, string | string[]>;
  attachments: Array<{ 
    filename: string; 
    contentType: string; 
    size: number;
    part?: string; // MIME part identifier (e.g., "1", "1.2", "2") for on-demand fetching
    imapUid?: number; // IMAP UID of the message (for on-demand fetching)
  }>;
}

export interface MessageJob {
  id: string;
  account_id: string;
  enrollment_id: string;
  campaign_id: string;
  lead_id: string;
  mailbox_id: string;
  node_id: string;
  status: 'queued' | 'reserved' | 'sending' | 'sent' | 'deferred' | 'failed' | 'cancelled' | 'blocked';
  scheduled_at: string;
  reserved_at: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  message_data: {
    subject?: string;
    node_config?: {
      subject?: string;
      body?: string;
      template?: string;
    };
    lead_data?: any;
    campaign_data?: any;
  };
  created_at: string;
  updated_at: string;
  enrollments?: any;
  campaigns?: any;
  leads?: {
    email: string;
    name?: string;
  };
  mailboxes?: {
    account_id: string;
    email_address: string | null;
  } | null;
}
