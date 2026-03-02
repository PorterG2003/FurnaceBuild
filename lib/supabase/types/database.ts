/**
 * Database type definitions
 * 
 * This file contains TypeScript types for your Supabase database tables.
 * These can be manually maintained or auto-generated from your Supabase schema.
 * 
 * To auto-generate types in the future:
 * 1. Install: npm install -D supabase
 * 2. Run: npx supabase gen types typescript --project-id <your-project-id> > lib/supabase/types/database.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      account_users: {
        Row: {
          id: string;
          account_id: string;
          user_id: string;
          is_owner: boolean;
          role: 'owner' | 'admin' | 'member';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          user_id: string;
          is_owner?: boolean;
          role?: 'owner' | 'admin' | 'member';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          user_id?: string;
          is_owner?: boolean;
          role?: 'owner' | 'admin' | 'member';
          created_at?: string;
          updated_at?: string;
        };
      };
      accounts: {
        Row: {
          id: string;
          name: string;
          jitter_percentage: number;
          suppress_bounced_emails: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          jitter_percentage?: number;
          suppress_bounced_emails?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          jitter_percentage?: number;
          suppress_bounced_emails?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      campaigns: {
        Row: {
          id: string;
          name: string;
          owner_id: string;
          organization_id: string | null;
          account_id: string | null;
          jitter_percentage: number | null;
          locked: boolean;
          flow_data: Json | null;
          schedule: Json | null;
          bucket_id: string;
          status: 'draft' | 'running' | 'paused' | 'stopped';
          sending_interval_seconds: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          owner_id: string;
          organization_id?: string | null;
          account_id?: string | null;
          jitter_percentage?: number | null;
          locked?: boolean;
          flow_data?: Json | null;
          schedule?: Json | null;
          bucket_id?: string;
          status?: 'draft' | 'running' | 'paused' | 'stopped';
          sending_interval_seconds?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          owner_id?: string;
          organization_id?: string | null;
          account_id?: string | null;
          jitter_percentage?: number | null;
          locked?: boolean;
          flow_data?: Json | null;
          schedule?: Json | null;
          bucket_id?: string;
          status?: 'draft' | 'running' | 'paused' | 'stopped';
          sending_interval_seconds?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      leads: {
        Row: {
          id: string;
          campaign_id: string;
          bucket_id: string;
          account_id: string;
          email: string | null;
          name: string | null;
          first_name: string | null;
          last_name: string | null;
          company_name: string | null;
          website: string | null;
          linkedin_url: string | null;
          company_linkedin_url: string | null;
          source: string | null;
          custom_lead_data: Json | null;
          global_lead_id: string | null;
          status: 'new' | 'processing' | 'completed' | 'failed' | 'paused' | 'removed';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          bucket_id: string;
          account_id: string;
          email?: string | null;
          name?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          company_name?: string | null;
          website?: string | null;
          linkedin_url?: string | null;
          company_linkedin_url?: string | null;
          source?: string | null;
          custom_lead_data?: Json | null;
          global_lead_id?: string | null;
          status?: 'new' | 'processing' | 'completed' | 'failed' | 'paused' | 'removed';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          bucket_id?: string;
          account_id?: string;
          email?: string | null;
          name?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          company_name?: string | null;
          website?: string | null;
          linkedin_url?: string | null;
          company_linkedin_url?: string | null;
          source?: string | null;
          custom_lead_data?: Json | null;
          global_lead_id?: string | null;
          status?: 'new' | 'processing' | 'completed' | 'failed' | 'paused' | 'removed';
          mailbox_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      enrollments: {
        Row: {
          id: string;
          campaign_id: string;
          account_id: string;
          lead_id: string;
          current_node_id: string | null;
          state: 'active' | 'paused' | 'stopped' | 'completed';
          next_run_at: string | null;
          flow_position: Json | null;
          created_at: string;
          updated_at: string;
          stopped_reason: 'replied' | 'bounced' | 'unsubscribed' | 'error' | null;
          stopped_at: string | null;
          stopped_error_message: string | null;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          account_id: string;
          lead_id: string;
          current_node_id?: string | null;
          state?: 'active' | 'paused' | 'stopped' | 'completed';
          next_run_at?: string | null;
          flow_position?: Json | null;
          created_at?: string;
          updated_at?: string;
          stopped_reason?: 'replied' | 'bounced' | 'unsubscribed' | 'error' | null;
          stopped_at?: string | null;
          stopped_error_message?: string | null;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          lead_id?: string;
          current_node_id?: string | null;
          state?: 'active' | 'paused' | 'stopped' | 'completed';
          next_run_at?: string | null;
          flow_position?: Json | null;
          created_at?: string;
          updated_at?: string;
          stopped_reason?: 'replied' | 'bounced' | 'unsubscribed' | 'error' | null;
          stopped_at?: string | null;
          stopped_error_message?: string | null;
        };
      };
      users: {
        Row: {
          id: string;
          external_id: string | null;
          email: string;
          name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          external_id?: string | null;
          email: string;
          name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          external_id?: string | null;
          email?: string;
          name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      invitations: {
        Row: {
          id: string;
          account_id: string;
          email: string;
          invited_by_user_id: string;
          status: 'pending' | 'accepted' | 'declined' | 'expired';
          created_at: string;
          updated_at: string;
          expires_at: string | null;
        };
        Insert: {
          id?: string;
          account_id: string;
          email: string;
          invited_by_user_id: string;
          status?: 'pending' | 'accepted' | 'declined' | 'expired';
          created_at?: string;
          updated_at?: string;
          expires_at?: string | null;
        };
        Update: {
          id?: string;
          account_id?: string;
          email?: string;
          invited_by_user_id?: string;
          status?: 'pending' | 'accepted' | 'declined' | 'expired';
          created_at?: string;
          updated_at?: string;
          expires_at?: string | null;
        };
      };
      mailboxes: {
        Row: {
          id: string;
          account_id: string;
          user_id: string;
          email_address: string;
          display_name: string | null;
          provider: 'gmail' | 'outlook' | 'custom';
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
          signature: string | null;
          error_message: string | null;
          min_gap_seconds: number | null;
          daily_limit: number | null;
          hourly_limit: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          user_id: string;
          email_address: string;
          display_name?: string | null;
          provider?: 'gmail' | 'outlook' | 'custom';
          smtp_host: string;
          smtp_port?: number;
          smtp_username: string;
          smtp_password: string;
          smtp_use_tls?: boolean;
          smtp_use_ssl?: boolean;
          imap_host: string;
          imap_port?: number;
          imap_username: string;
          imap_password: string;
          imap_use_ssl?: boolean;
          status?: 'connected' | 'disconnected' | 'error';
          last_synced_at?: string | null;
          signature?: string | null;
          error_message?: string | null;
          min_gap_seconds?: number | null;
          daily_limit?: number | null;
          hourly_limit?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          user_id?: string;
          email_address?: string;
          display_name?: string | null;
          provider?: 'gmail' | 'outlook' | 'custom';
          smtp_host?: string;
          smtp_port?: number;
          smtp_username?: string;
          smtp_password?: string;
          smtp_use_tls?: boolean;
          smtp_use_ssl?: boolean;
          imap_host?: string;
          imap_port?: number;
          imap_username?: string;
          imap_password?: string;
          imap_use_ssl?: boolean;
          status?: 'connected' | 'disconnected' | 'error';
          last_synced_at?: string | null;
          signature?: string | null;
          error_message?: string | null;
          min_gap_seconds?: number | null;
          daily_limit?: number | null;
          hourly_limit?: number | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      email_threads: {
        Row: {
          id: string;
          account_id: string;
          campaign_id: string | null;
          lead_id: string | null;
          enrollment_id: string | null;
          message_job_id: string | null;
          mailbox_id: string | null;
          subject: string;
          participants: string[];
          last_message_at: string;
          message_count: number;
          has_reply: boolean;
          category: string | null;
          category_source: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          campaign_id?: string | null;
          lead_id?: string | null;
          enrollment_id?: string | null;
          message_job_id?: string | null;
          mailbox_id?: string | null;
          subject: string;
          participants?: string[];
          last_message_at: string;
          message_count?: number;
          has_reply?: boolean;
          category?: string | null;
          category_source?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          campaign_id?: string;
          lead_id?: string;
          enrollment_id?: string;
          message_job_id?: string;
          mailbox_id?: string;
          subject?: string;
          participants?: string[];
          last_message_at?: string;
          message_count?: number;
          has_reply?: boolean;
          category?: string | null;
          category_source?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      email_messages: {
        Row: {
          id: string;
          thread_id: string;
          account_id: string;
          message_job_id: string | null;
          direction: 'sent' | 'received';
          from_email: string;
          from_name: string | null;
          to_email: string;
          to_name: string | null;
          cc: string[] | null;
          subject: string;
          body_text: string | null;
          body_html: string | null;
          message_id: string | null;
          in_reply_to: string | null;
          message_references: string | null;
          received_at: string;
          read_at: string | null;
          headers: Json;
          attachments: Json;
          imap_uid: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          thread_id: string;
          account_id: string;
          message_job_id?: string | null;
          direction: 'sent' | 'received';
          from_email: string;
          from_name?: string | null;
          to_email: string;
          to_name?: string | null;
          cc?: string[] | null;
          subject: string;
          body_text?: string | null;
          body_html?: string | null;
          message_id?: string | null;
          in_reply_to?: string | null;
          message_references?: string | null;
          received_at: string;
          read_at?: string | null;
          headers?: Json;
          attachments?: Json;
          imap_uid?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          thread_id?: string;
          account_id?: string;
          message_job_id?: string | null;
          direction?: 'sent' | 'received';
          from_email?: string;
          from_name?: string | null;
          to_email?: string;
          to_name?: string | null;
          cc?: string[] | null;
          subject?: string;
          body_text?: string | null;
          body_html?: string | null;
          message_id?: string | null;
          in_reply_to?: string | null;
          message_references?: string | null;
          received_at?: string;
          read_at?: string | null;
          headers?: Json;
          attachments?: Json;
          imap_uid?: number | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      block_list: {
        Row: {
          id: string;
          account_id: string;
          value: string;
          type: 'email' | 'domain';
          reason: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          account_id: string;
          value: string;
          type: 'email' | 'domain';
          reason?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          account_id?: string;
          value?: string;
          type?: 'email' | 'domain';
          reason?: string | null;
          created_at?: string | null;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
  };
}


