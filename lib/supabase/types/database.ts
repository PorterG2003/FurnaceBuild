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
          source: string | null;
          smartlead_campaign_id: number | null;
          smartlead_created_at: string | null;
          current_flow_version_number: number;
          deleted_at: string | null;
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
          source?: string | null;
          smartlead_campaign_id?: number | null;
          smartlead_created_at?: string | null;
          current_flow_version_number?: number;
          deleted_at?: string | null;
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
          source?: string | null;
          smartlead_campaign_id?: number | null;
          smartlead_created_at?: string | null;
          current_flow_version_number?: number;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      campaign_flow_versions: {
        Row: {
          id: string;
          campaign_id: string;
          account_id: string;
          version_number: number;
          flow_data: Json | null;
          flow_hash: string | null;
          changed_at: string;
          changed_by_user_id: string | null;
          change_source: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          account_id: string;
          version_number: number;
          flow_data?: Json | null;
          flow_hash?: string | null;
          changed_at?: string;
          changed_by_user_id?: string | null;
          change_source?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          account_id?: string;
          version_number?: number;
          flow_data?: Json | null;
          flow_hash?: string | null;
          changed_at?: string;
          changed_by_user_id?: string | null;
          change_source?: string;
          created_at?: string;
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
          phone_number: string | null;
          source: string | null;
          custom_lead_data: Json | null;
          global_lead_id: string | null;
          smartlead_lead_id: number | null;
          status: 'new' | 'processing' | 'completed' | 'failed' | 'paused' | 'removed';
          deleted_at: string | null;
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
          phone_number?: string | null;
          source?: string | null;
          custom_lead_data?: Json | null;
          global_lead_id?: string | null;
          smartlead_lead_id?: number | null;
          status?: 'new' | 'processing' | 'completed' | 'failed' | 'paused' | 'removed';
          deleted_at?: string | null;
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
          phone_number?: string | null;
          source?: string | null;
          custom_lead_data?: Json | null;
          global_lead_id?: string | null;
          smartlead_lead_id?: number | null;
          status?: 'new' | 'processing' | 'completed' | 'failed' | 'paused' | 'removed';
          deleted_at?: string | null;
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
          current_flow_version_number: number | null;
          state: 'active' | 'paused' | 'stopped' | 'completed';
          next_run_at: string | null;
          flow_position: Json | null;
          deleted_at: string | null;
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
          current_flow_version_number?: number | null;
          state?: 'active' | 'paused' | 'stopped' | 'completed';
          next_run_at?: string | null;
          flow_position?: Json | null;
          deleted_at?: string | null;
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
          current_flow_version_number?: number | null;
          state?: 'active' | 'paused' | 'stopped' | 'completed';
          next_run_at?: string | null;
          flow_position?: Json | null;
          deleted_at?: string | null;
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
      user_access_flags: {
        Row: {
          user_id: string;
          flag_key: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          flag_key: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          flag_key?: string;
          created_at?: string;
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
      imported_campaign_stats_by_day: {
        Row: {
          campaign_id: string;
          date: string;
          sent_count: number;
          replied_count: number;
          positive_reply_count: number;
          bounce_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          campaign_id: string;
          date: string;
          sent_count?: number;
          replied_count?: number;
          positive_reply_count?: number;
          bounce_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          campaign_id?: string;
          date?: string;
          sent_count?: number;
          replied_count?: number;
          positive_reply_count?: number;
          bounce_count?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      smartlead_migration_runs: {
        Row: {
          id: string;
          account_id: string;
          created_by: string;
          status:
            | 'queued'
            | 'launch_requested'
            | 'task_started'
            | 'running'
            | 'cancel_requested'
            | 'completed'
            | 'completed_with_warnings'
            | 'failed'
            | 'failed_to_launch'
            | 'failed_to_claim'
            | 'cancelled';
          selected_campaign_count: number;
          completed_campaign_count: number;
          failed_campaign_count: number;
          leads_imported: number;
          conversations_imported: number;
          totals_stats_campaign_count: number;
          day_by_day_stats_campaign_count: number;
          warning_count: number;
          current_campaign_id: number | null;
          current_campaign_name: string | null;
          current_phase: 'campaign' | 'leads' | 'enrollments' | 'conversations' | 'stats' | 'done' | null;
          current_detail: string | null;
          last_error_message: string | null;
          cancel_requested_at: string | null;
          launch_requested_at: string | null;
          launched_at: string | null;
          started_at: string | null;
          finished_at: string | null;
          last_heartbeat_at: string | null;
          task_arn: string | null;
          worker_id: string | null;
          api_key_secret_ref: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          created_by: string;
          status?:
            | 'queued'
            | 'launch_requested'
            | 'task_started'
            | 'running'
            | 'cancel_requested'
            | 'completed'
            | 'completed_with_warnings'
            | 'failed'
            | 'failed_to_launch'
            | 'failed_to_claim'
            | 'cancelled';
          selected_campaign_count?: number;
          completed_campaign_count?: number;
          failed_campaign_count?: number;
          leads_imported?: number;
          conversations_imported?: number;
          totals_stats_campaign_count?: number;
          day_by_day_stats_campaign_count?: number;
          warning_count?: number;
          current_campaign_id?: number | null;
          current_campaign_name?: string | null;
          current_phase?: 'campaign' | 'leads' | 'enrollments' | 'conversations' | 'stats' | 'done' | null;
          current_detail?: string | null;
          last_error_message?: string | null;
          cancel_requested_at?: string | null;
          launch_requested_at?: string | null;
          launched_at?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          last_heartbeat_at?: string | null;
          task_arn?: string | null;
          worker_id?: string | null;
          api_key_secret_ref?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          created_by?: string;
          status?:
            | 'queued'
            | 'launch_requested'
            | 'task_started'
            | 'running'
            | 'cancel_requested'
            | 'completed'
            | 'completed_with_warnings'
            | 'failed'
            | 'failed_to_launch'
            | 'failed_to_claim'
            | 'cancelled';
          selected_campaign_count?: number;
          completed_campaign_count?: number;
          failed_campaign_count?: number;
          leads_imported?: number;
          conversations_imported?: number;
          totals_stats_campaign_count?: number;
          day_by_day_stats_campaign_count?: number;
          warning_count?: number;
          current_campaign_id?: number | null;
          current_campaign_name?: string | null;
          current_phase?: 'campaign' | 'leads' | 'enrollments' | 'conversations' | 'stats' | 'done' | null;
          current_detail?: string | null;
          last_error_message?: string | null;
          cancel_requested_at?: string | null;
          launch_requested_at?: string | null;
          launched_at?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          last_heartbeat_at?: string | null;
          task_arn?: string | null;
          worker_id?: string | null;
          api_key_secret_ref?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      smartlead_migration_campaigns: {
        Row: {
          id: string;
          run_id: string;
          account_id: string;
          order_index: number;
          smartlead_campaign_id: number;
          campaign_name: string;
          smartlead_created_at: string | null;
          furnace_campaign_id: string | null;
          status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
          attempt_count: number;
          last_phase: 'campaign' | 'leads' | 'enrollments' | 'conversations' | 'stats' | 'done' | null;
          current_detail: string | null;
          last_error_message: string | null;
          leads_imported: number;
          conversations_imported: number;
          totals_stats_imported: boolean;
          day_by_day_stats_imported: boolean;
          replied_from_api: number;
          leads_matched: number;
          skipped_no_match: number;
          skipped_empty_history: number;
          started_at: string | null;
          finished_at: string | null;
          last_heartbeat_at: string | null;
          worker_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          run_id: string;
          account_id: string;
          order_index: number;
          smartlead_campaign_id: number;
          campaign_name: string;
          smartlead_created_at?: string | null;
          furnace_campaign_id?: string | null;
          status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
          attempt_count?: number;
          last_phase?: 'campaign' | 'leads' | 'enrollments' | 'conversations' | 'stats' | 'done' | null;
          current_detail?: string | null;
          last_error_message?: string | null;
          leads_imported?: number;
          conversations_imported?: number;
          totals_stats_imported?: boolean;
          day_by_day_stats_imported?: boolean;
          replied_from_api?: number;
          leads_matched?: number;
          skipped_no_match?: number;
          skipped_empty_history?: number;
          started_at?: string | null;
          finished_at?: string | null;
          last_heartbeat_at?: string | null;
          worker_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          run_id?: string;
          account_id?: string;
          order_index?: number;
          smartlead_campaign_id?: number;
          campaign_name?: string;
          smartlead_created_at?: string | null;
          furnace_campaign_id?: string | null;
          status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
          attempt_count?: number;
          last_phase?: 'campaign' | 'leads' | 'enrollments' | 'conversations' | 'stats' | 'done' | null;
          current_detail?: string | null;
          last_error_message?: string | null;
          leads_imported?: number;
          conversations_imported?: number;
          totals_stats_imported?: boolean;
          day_by_day_stats_imported?: boolean;
          replied_from_api?: number;
          leads_matched?: number;
          skipped_no_match?: number;
          skipped_empty_history?: number;
          started_at?: string | null;
          finished_at?: string | null;
          last_heartbeat_at?: string | null;
          worker_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      smartlead_migration_events: {
        Row: {
          id: string;
          run_id: string;
          campaign_row_id: string | null;
          account_id: string;
          event_type: string;
          level: 'info' | 'warning' | 'error';
          phase: 'campaign' | 'leads' | 'enrollments' | 'conversations' | 'stats' | 'done' | null;
          detail: string | null;
          payload: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          run_id: string;
          campaign_row_id?: string | null;
          account_id: string;
          event_type: string;
          level?: 'info' | 'warning' | 'error';
          phase?: 'campaign' | 'leads' | 'enrollments' | 'conversations' | 'stats' | 'done' | null;
          detail?: string | null;
          payload?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          run_id?: string;
          campaign_row_id?: string | null;
          account_id?: string;
          event_type?: string;
          level?: 'info' | 'warning' | 'error';
          phase?: 'campaign' | 'leads' | 'enrollments' | 'conversations' | 'stats' | 'done' | null;
          detail?: string | null;
          payload?: Json;
          created_at?: string;
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
          deleted_at: string | null;
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
          deleted_at?: string | null;
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
          deleted_at?: string | null;
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
          smartlead_lead_id: number | null;
          subject: string;
          participants: string[];
          last_message_at: string;
          message_count: number;
          has_reply: boolean;
          category: string | null;
          category_source: string | null;
          out_of_office: boolean;
          ooo_resume_requested: boolean;
          ooo_resume_at: string | null;
          ooo_resume_processed_at: string | null;
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
          smartlead_lead_id?: number | null;
          subject: string;
          participants?: string[];
          last_message_at: string;
          message_count?: number;
          has_reply?: boolean;
          category?: string | null;
          category_source?: string | null;
          out_of_office?: boolean;
          ooo_resume_requested?: boolean;
          ooo_resume_at?: string | null;
          ooo_resume_processed_at?: string | null;
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
          smartlead_lead_id?: number | null;
          subject?: string;
          participants?: string[];
          last_message_at?: string;
          message_count?: number;
          has_reply?: boolean;
          category?: string | null;
          category_source?: string | null;
          out_of_office?: boolean;
          ooo_resume_requested?: boolean;
          ooo_resume_at?: string | null;
          ooo_resume_processed_at?: string | null;
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
      notification_deliveries: {
        Row: {
          id: string;
          notification_id: string;
          account_id: string;
          channel: 'in_app' | 'web_push';
          provider: string;
          status: 'pending' | 'sending' | 'delivered' | 'failed' | 'skipped';
          attempt_count: number;
          last_attempt_at: string | null;
          delivered_at: string | null;
          provider_message_id: string | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          notification_id: string;
          account_id: string;
          channel: 'in_app' | 'web_push';
          provider?: string;
          status?: 'pending' | 'sending' | 'delivered' | 'failed' | 'skipped';
          attempt_count?: number;
          last_attempt_at?: string | null;
          delivered_at?: string | null;
          provider_message_id?: string | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          notification_id?: string;
          account_id?: string;
          channel?: 'in_app' | 'web_push';
          provider?: string;
          status?: 'pending' | 'sending' | 'delivered' | 'failed' | 'skipped';
          attempt_count?: number;
          last_attempt_at?: string | null;
          delivered_at?: string | null;
          provider_message_id?: string | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      notification_events: {
        Row: {
          id: string;
          account_id: string;
          event_type: string;
          resource_type: string | null;
          resource_id: string | null;
          payload: Json;
          occurred_at: string;
          dedupe_key: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          event_type: string;
          resource_type?: string | null;
          resource_id?: string | null;
          payload?: Json;
          occurred_at?: string;
          dedupe_key?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          event_type?: string;
          resource_type?: string | null;
          resource_id?: string | null;
          payload?: Json;
          occurred_at?: string;
          dedupe_key?: string | null;
          created_at?: string;
        };
      };
      notification_preferences: {
        Row: {
          id: string;
          user_id: string;
          account_id: string;
          event_type: string;
          channel: 'in_app' | 'web_push';
          enabled: boolean;
          frequency: 'instant' | 'digest' | 'muted';
          quiet_hours: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          account_id: string;
          event_type: string;
          channel: 'in_app' | 'web_push';
          enabled?: boolean;
          frequency?: 'instant' | 'digest' | 'muted';
          quiet_hours?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          account_id?: string;
          event_type?: string;
          channel?: 'in_app' | 'web_push';
          enabled?: boolean;
          frequency?: 'instant' | 'digest' | 'muted';
          quiet_hours?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          account_id: string;
          event_id: string;
          title: string;
          body: string | null;
          status: 'unread' | 'read' | 'archived';
          read_at: string | null;
          archived_at: string | null;
          action_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          account_id: string;
          event_id: string;
          title: string;
          body?: string | null;
          status?: 'unread' | 'read' | 'archived';
          read_at?: string | null;
          archived_at?: string | null;
          action_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          account_id?: string;
          event_id?: string;
          title?: string;
          body?: string | null;
          status?: 'unread' | 'read' | 'archived';
          read_at?: string | null;
          archived_at?: string | null;
          action_url?: string | null;
          created_at?: string;
        };
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          account_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          last_seen_at: string;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          account_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          last_seen_at?: string;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          account_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          user_agent?: string | null;
          last_seen_at?: string;
          revoked_at?: string | null;
          created_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_smartlead_migration_run: {
        Args: {
          p_account_id: string;
          p_selected_campaigns: Json;
        };
        Returns: string;
      };
      cancel_smartlead_migration_run: {
        Args: {
          p_run_id: string;
        };
        Returns: boolean;
      };
      cancel_unsent_campaign_jobs: {
        Args: {
          p_campaign_id: string;
          p_reason?: string;
        };
        Returns: number;
      };
      mark_email_thread_out_of_office: {
        Args: {
          p_thread_id: string;
          p_out_of_office: boolean;
          p_resume_requested: boolean;
          p_resume_at?: string | null;
        };
        Returns: undefined;
      };
      process_due_out_of_office_resumes: {
        Args: {
          p_batch_size?: number;
        };
        Returns: number;
      };
      resume_campaign_and_reschedule_jobs: {
        Args: {
          p_campaign_id: string;
          p_pause_reason?: string;
        };
        Returns: {
          revived_jobs: number;
          rescheduled_jobs: number;
        }[];
      };
      stop_campaign_and_stop_enrollments: {
        Args: {
          p_campaign_id: string;
        };
        Returns: number;
      };
      claim_smartlead_migration_run: {
        Args: {
          p_run_id: string;
          p_worker_id: string;
          p_task_arn?: string | null;
          p_processing_timeout_minutes?: number;
        };
        Returns: boolean;
      };
      claim_next_smartlead_migration_campaign: {
        Args: {
          p_run_id: string;
          p_worker_id: string;
          p_processing_timeout_minutes?: number;
        };
        Returns: {
          id: string;
          run_id: string;
          account_id: string;
          order_index: number;
          smartlead_campaign_id: number;
          campaign_name: string;
          smartlead_created_at: string | null;
          attempt_count: number;
        }[];
      };
      create_test_notification: {
        Args: {
          p_account_id: string;
          p_payload?: Json;
        };
        Returns: string;
      };
      latest_reply_category_by_campaign: {
        Args: { p_campaign_id: string };
        Returns: { lead_id: string; reply_category: string | null }[];
      };
      campaign_leads_table_page: {
        Args: {
          p_campaign_id: string;
          p_scoped_ids: string[];
          p_statuses: string[] | null;
          p_search: string | null;
          p_sort: string;
          p_asc: boolean;
          p_limit: number;
          p_offset: number;
        };
        Returns: {
          id: string;
          email: string | null;
          name: string | null;
          first_name: string | null;
          last_name: string | null;
          company_name: string | null;
          website: string | null;
          linkedin_url: string | null;
          company_linkedin_url: string | null;
          phone_number: string | null;
          source: string | null;
          custom_lead_data: Json | null;
          status: string;
          created_at: string;
          total_count: number;
        }[];
      };
      account_outreach_metrics: {
        Args: { p_account_id: string; p_start_date: string; p_end_date: string };
        Returns: {
          total_sent: number;
          total_positive_reply: number;
          leads_reached: number;
          leads_in_queue: number;
          smartlead_import_warning: boolean;
        }[];
      };
      account_outreach_stats_by_day: {
        Args: { p_account_id: string; p_start_date: string; p_end_date: string };
        Returns: {
          stat_date: string;
          sent_count: number;
          replied_count: number;
          positive_reply_count: number;
          bounce_count: number;
        }[];
      };
      campaigns_list_summary: {
        Args: { p_account_id: string };
        Returns: {
          id: string;
          name: string;
          status: string;
          created_at: string;
          source: string | null;
          has_flow: boolean;
          sent_count: number;
          replied_count: number;
          positive_reply_count: number;
          bounce_count: number;
          enrollment_count: number;
          terminal_enrollment_count: number;
          contacted_enrollment_count: number;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
  };
}


