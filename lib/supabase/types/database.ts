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
          webhook_url: string | null;
          webhook_signing_secret: string | null;
          webhook_enabled_events: Json;
          onboarding_segment: 'self_serve' | 'dfy' | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          jitter_percentage?: number;
          suppress_bounced_emails?: boolean;
          webhook_url?: string | null;
          webhook_signing_secret?: string | null;
          webhook_enabled_events?: Json;
          onboarding_segment?: 'self_serve' | 'dfy' | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          jitter_percentage?: number;
          suppress_bounced_emails?: boolean;
          webhook_url?: string | null;
          webhook_signing_secret?: string | null;
          webhook_enabled_events?: Json;
          onboarding_segment?: 'self_serve' | 'dfy' | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      account_billing: {
        Row: {
          account_id: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          monthly_retainer_cents: number;
          billing_status: 'active' | 'payment_required' | 'canceled';
          billing_anchor_day: number;
          frontend_access_blocked_at: string | null;
          last_payment_failed_at: string | null;
          agreement_type: 'platform_agreement' | 'managed_services_agreement' | null;
          proposal_snapshot_json: Record<string, unknown> | null;
          terms_version: string | null;
          terms_snapshot_markdown: string | null;
          accepted_amendment_id: string | null;
          preferred_payment_route: 'card' | 'ach' | null;
          pending_first_delta_coupon_cents: number | null;
          upgrade_delta_invoice_id: string | null;
          upgrade_delta_charged_at: string | null;
          scheduled_monthly_retainer_cents: number | null;
          scheduled_retainer_effective_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          monthly_retainer_cents: number;
          billing_status?: 'active' | 'payment_required' | 'canceled';
          billing_anchor_day?: number;
          frontend_access_blocked_at?: string | null;
          last_payment_failed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          monthly_retainer_cents?: number;
          billing_status?: 'active' | 'payment_required' | 'canceled';
          billing_anchor_day?: number;
          frontend_access_blocked_at?: string | null;
          last_payment_failed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      billing_adjustments: {
        Row: {
          id: string;
          account_id: string;
          billing_year: number;
          billing_month: number;
          discount_cents: number;
          reason: string;
          created_by_user_id: string;
          stripe_coupon_id: string | null;
          stripe_invoice_item_id: string | null;
          applied_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          billing_year: number;
          billing_month: number;
          discount_cents: number;
          reason: string;
          created_by_user_id: string;
          stripe_coupon_id?: string | null;
          stripe_invoice_item_id?: string | null;
          applied_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          billing_year?: number;
          billing_month?: number;
          discount_cents?: number;
          reason?: string;
          created_by_user_id?: string;
          stripe_coupon_id?: string | null;
          stripe_invoice_item_id?: string | null;
          applied_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      account_lead_people: {
        Row: {
          account_id: string;
          global_lead_id: string;
          email: string | null;
          display_name: string | null;
          first_name: string | null;
          last_name: string | null;
          campaign_count: number;
          native_campaign_count: number;
          smartlead_campaign_count: number;
          company_list: string | null;
          has_reply: boolean;
          latest_activity_at: string | null;
          newest_membership_created_at: string | null;
          search_text: string | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          global_lead_id: string;
          email?: string | null;
          display_name?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          campaign_count?: number;
          native_campaign_count?: number;
          smartlead_campaign_count?: number;
          company_list?: string | null;
          has_reply?: boolean;
          latest_activity_at?: string | null;
          newest_membership_created_at?: string | null;
          search_text?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          global_lead_id?: string;
          email?: string | null;
          display_name?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          campaign_count?: number;
          native_campaign_count?: number;
          smartlead_campaign_count?: number;
          company_list?: string | null;
          has_reply?: boolean;
          latest_activity_at?: string | null;
          newest_membership_created_at?: string | null;
          search_text?: string | null;
          updated_at?: string;
        };
      };
      account_api_keys: {
        Row: {
          id: string;
          account_id: string;
          created_by_user_id: string;
          name: string;
          key_hash: string;
          secret_prefix: string;
          expires_at: string | null;
          last_used_at: string | null;
          revoked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          created_by_user_id: string;
          name: string;
          key_hash: string;
          secret_prefix: string;
          expires_at?: string | null;
          last_used_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          created_by_user_id?: string;
          name?: string;
          key_hash?: string;
          secret_prefix?: string;
          expires_at?: string | null;
          last_used_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      api_idempotency_keys: {
        Row: {
          id: string;
          account_id: string;
          idempotency_key: string;
          route: string;
          body_hash: string;
          response: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          idempotency_key: string;
          route: string;
          body_hash: string;
          response?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          idempotency_key?: string;
          route?: string;
          body_hash?: string;
          response?: Json;
          created_at?: string;
        };
      };
      api_rate_limit_buckets: {
        Row: {
          id: string;
          account_id: string;
          window_start: string;
          request_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          window_start: string;
          request_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          window_start?: string;
          request_count?: number;
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
          webhook_url_override: string | null;
          webhook_signing_secret_override: string | null;
          webhook_enabled_events_override: Json | null;
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
          webhook_url_override?: string | null;
          webhook_signing_secret_override?: string | null;
          webhook_enabled_events_override?: Json | null;
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
          webhook_url_override?: string | null;
          webhook_signing_secret_override?: string | null;
          webhook_enabled_events_override?: Json | null;
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
      campaign_mailboxes: {
        Row: {
          id: string;
          campaign_id: string;
          mailbox_id: string;
          account_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          mailbox_id: string;
          account_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          mailbox_id?: string;
          account_id?: string;
          created_at?: string;
        };
      };
      campaign_stats: {
        Row: {
          campaign_id: string;
          account_id: string;
          sent_count: number;
          replied_count: number;
          positive_reply_count: number;
          bounce_count: number;
          last_bounce_at: string | null;
          updated_at: string;
        };
        Insert: {
          campaign_id: string;
          account_id: string;
          sent_count?: number;
          replied_count?: number;
          positive_reply_count?: number;
          bounce_count?: number;
          last_bounce_at?: string | null;
          updated_at?: string;
        };
        Update: {
          campaign_id?: string;
          account_id?: string;
          sent_count?: number;
          replied_count?: number;
          positive_reply_count?: number;
          bounce_count?: number;
          last_bounce_at?: string | null;
          updated_at?: string;
        };
      };
      nodes: {
        Row: {
          id: string;
          campaign_id: string;
          account_id: string;
          flow_node_id: string;
          node_type: string;
          node_data: Json;
          position_x: number | null;
          position_y: number | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          account_id: string;
          flow_node_id: string;
          node_type: string;
          node_data?: Json;
          position_x?: number | null;
          position_y?: number | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          account_id?: string;
          flow_node_id?: string;
          node_type?: string;
          node_data?: Json;
          position_x?: number | null;
          position_y?: number | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      message_jobs: {
        Row: {
          id: string;
          enrollment_id: string;
          campaign_id: string;
          account_id: string;
          lead_id: string;
          mailbox_id: string;
          node_id: string;
          status: string;
          status_reason: string | null;
          message_type: string | null;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          enrollment_id: string;
          campaign_id: string;
          account_id: string;
          lead_id: string;
          mailbox_id: string;
          node_id: string;
          status?: string;
          status_reason?: string | null;
          message_type?: string | null;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          enrollment_id?: string;
          campaign_id?: string;
          account_id?: string;
          lead_id?: string;
          mailbox_id?: string;
          node_id?: string;
          status?: string;
          status_reason?: string | null;
          message_type?: string | null;
          error_message?: string | null;
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
          phone_number: string | null;
          mobile_phone_number: string | null;
          source: string | null;
          custom_lead_data: Json | null;
          global_lead_id: string | null;
          smartlead_lead_id: number | null;
          mailbox_id: string | null;
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
          mobile_phone_number?: string | null;
          source?: string | null;
          custom_lead_data?: Json | null;
          global_lead_id?: string | null;
          smartlead_lead_id?: number | null;
          mailbox_id?: string | null;
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
          mobile_phone_number?: string | null;
          source?: string | null;
          custom_lead_data?: Json | null;
          global_lead_id?: string | null;
          smartlead_lead_id?: number | null;
          deleted_at?: string | null;
          mailbox_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      lead_saved_lists: {
        Row: {
          id: string;
          account_id: string;
          name: string;
          description: string | null;
          column_layout: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          name: string;
          description?: string | null;
          column_layout?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          name?: string;
          description?: string | null;
          column_layout?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
      lead_saved_list_members: {
        Row: {
          list_id: string;
          account_id: string;
          global_lead_id: string;
          source: 'selection' | 'csv' | 'manual';
          created_at: string;
        };
        Insert: {
          list_id: string;
          account_id: string;
          global_lead_id: string;
          source?: 'selection' | 'csv' | 'manual';
          created_at?: string;
        };
        Update: {
          list_id?: string;
          account_id?: string;
          global_lead_id?: string;
          source?: 'selection' | 'csv' | 'manual';
          created_at?: string;
        };
      };
      lead_replacements: {
        Row: {
          id: string;
          account_id: string;
          campaign_id: string | null;
          old_lead_id: string;
          new_lead_id: string;
          status: 'suggested' | 'confirmed' | 'completed' | 'cancelled';
          reason: 'auto_reply_forward' | 'manual_referral' | 'wrong_contact' | 'role_change' | 'other';
          reason_note: string | null;
          source_message_id: string | null;
          created_by: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          account_id: string;
          campaign_id?: string | null;
          old_lead_id: string;
          new_lead_id: string;
          status?: 'suggested' | 'confirmed' | 'completed' | 'cancelled';
          reason: 'auto_reply_forward' | 'manual_referral' | 'wrong_contact' | 'role_change' | 'other';
          reason_note?: string | null;
          source_message_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          account_id?: string;
          campaign_id?: string | null;
          old_lead_id?: string;
          new_lead_id?: string;
          status?: 'suggested' | 'confirmed' | 'completed' | 'cancelled';
          reason?: 'auto_reply_forward' | 'manual_referral' | 'wrong_contact' | 'role_change' | 'other';
          reason_note?: string | null;
          source_message_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          completed_at?: string | null;
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
      user_onboarding_state: {
        Row: {
          user_id: string;
          flow_id: string;
          flow_version: number;
          status: 'completed' | 'dismissed' | 'aborted';
          updated_at: string;
        };
        Insert: {
          user_id: string;
          flow_id: string;
          flow_version?: number;
          status: 'completed' | 'dismissed' | 'aborted';
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          flow_id?: string;
          flow_version?: number;
          status?: 'completed' | 'dismissed' | 'aborted';
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
      platform_invitations: {
        Row: {
          id: string;
          email: string;
          invited_by_user_id: string;
          status:
            | 'draft'
            | 'sent'
            | 'pending_payment'
            | 'active'
            | 'expired'
            | 'revoked';
          expires_at: string | null;
          viewed_at: string | null;
          proposed_account_name: string | null;
          monthly_retainer_cents: number;
          currency: string;
          proposal_snapshot_json: Json;
          agreement_type: 'platform_agreement' | 'managed_services_agreement';
          terms_version: string;
          terms_source_markdown: string;
          terms_snapshot_markdown: string;
          terms_accepted_at: string | null;
          terms_accepted_ip: string | null;
          accepted_by_user_id: string | null;
          prepared_full_name: string | null;
          prepared_account_name: string | null;
          auto_add_internal_admins: boolean;
          created_account_id: string | null;
          current_revision_number: number;
          published_revision_number: number | null;
          checkout_revision_number: number | null;
          accepted_revision_number: number | null;
          approved_at: string | null;
          sent_at: string | null;
          last_email_sent_at: string | null;
          selected_payment_route: 'card' | 'ach' | null;
          selected_payment_route_fee_cents: number;
          selected_payment_subtotal_cents: number | null;
          selected_payment_total_cents: number | null;
          upfront_stripe_invoice_id: string | null;
          upfront_stripe_payment_intent_id: string | null;
          stripe_checkout_session_id: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          recurring_anchor_at: string | null;
          first_recurring_invoice_target_cents: number | null;
          first_recurring_coupon_id: string | null;
          payment_completed_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          invited_by_user_id: string;
          status?:
            | 'draft'
            | 'sent'
            | 'pending_payment'
            | 'active'
            | 'expired'
            | 'revoked';
          expires_at?: string | null;
          viewed_at?: string | null;
          proposed_account_name?: string | null;
          monthly_retainer_cents: number;
          currency?: string;
          proposal_snapshot_json?: Json;
          agreement_type?: 'platform_agreement' | 'managed_services_agreement';
          terms_version: string;
          terms_source_markdown: string;
          terms_snapshot_markdown: string;
          terms_accepted_at?: string | null;
          terms_accepted_ip?: string | null;
          accepted_by_user_id?: string | null;
          prepared_full_name?: string | null;
          prepared_account_name?: string | null;
          auto_add_internal_admins?: boolean;
          created_account_id?: string | null;
          current_revision_number?: number;
          published_revision_number?: number | null;
          checkout_revision_number?: number | null;
          accepted_revision_number?: number | null;
          approved_at?: string | null;
          sent_at?: string | null;
          last_email_sent_at?: string | null;
          selected_payment_route?: 'card' | 'ach' | null;
          selected_payment_route_fee_cents?: number;
          selected_payment_subtotal_cents?: number | null;
          selected_payment_total_cents?: number | null;
          upfront_stripe_invoice_id?: string | null;
          upfront_stripe_payment_intent_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          recurring_anchor_at?: string | null;
          first_recurring_invoice_target_cents?: number | null;
          first_recurring_coupon_id?: string | null;
          payment_completed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          invited_by_user_id?: string;
          status?:
            | 'draft'
            | 'sent'
            | 'pending_payment'
            | 'active'
            | 'expired'
            | 'revoked';
          expires_at?: string | null;
          viewed_at?: string | null;
          proposed_account_name?: string | null;
          monthly_retainer_cents?: number;
          currency?: string;
          proposal_snapshot_json?: Json;
          agreement_type?: 'platform_agreement' | 'managed_services_agreement';
          terms_version?: string;
          terms_source_markdown?: string;
          terms_snapshot_markdown?: string;
          terms_accepted_at?: string | null;
          terms_accepted_ip?: string | null;
          accepted_by_user_id?: string | null;
          prepared_full_name?: string | null;
          prepared_account_name?: string | null;
          auto_add_internal_admins?: boolean;
          created_account_id?: string | null;
          current_revision_number?: number;
          published_revision_number?: number | null;
          checkout_revision_number?: number | null;
          accepted_revision_number?: number | null;
          approved_at?: string | null;
          sent_at?: string | null;
          last_email_sent_at?: string | null;
          selected_payment_route?: 'card' | 'ach' | null;
          selected_payment_route_fee_cents?: number;
          selected_payment_subtotal_cents?: number | null;
          selected_payment_total_cents?: number | null;
          upfront_stripe_invoice_id?: string | null;
          upfront_stripe_payment_intent_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          recurring_anchor_at?: string | null;
          first_recurring_invoice_target_cents?: number | null;
          first_recurring_coupon_id?: string | null;
          payment_completed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      platform_invitation_revisions: {
        Row: {
          id: string;
          invitation_id: string;
          revision_number: number;
          email: string;
          proposed_account_name: string | null;
          monthly_retainer_cents: number;
          currency: string;
          proposal_snapshot_json: Json;
          agreement_type: 'platform_agreement' | 'managed_services_agreement';
          terms_version: string;
          terms_source_markdown: string;
          terms_snapshot_markdown: string;
          created_by_user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          invitation_id: string;
          revision_number: number;
          email: string;
          proposed_account_name?: string | null;
          monthly_retainer_cents: number;
          currency?: string;
          proposal_snapshot_json?: Json;
          agreement_type?: 'platform_agreement' | 'managed_services_agreement';
          terms_version: string;
          terms_source_markdown: string;
          terms_snapshot_markdown: string;
          created_by_user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          invitation_id?: string;
          revision_number?: number;
          email?: string;
          proposed_account_name?: string | null;
          monthly_retainer_cents?: number;
          currency?: string;
          proposal_snapshot_json?: Json;
          agreement_type?: 'platform_agreement' | 'managed_services_agreement';
          terms_version?: string;
          terms_source_markdown?: string;
          terms_snapshot_markdown?: string;
          created_by_user_id?: string;
          created_at?: string;
        };
      };
      platform_terms_versions: {
        Row: {
          version: string;
          agreement_type: 'platform_agreement' | 'managed_services_agreement';
          title: string;
          body_markdown: string;
          effective_at: string;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          version: string;
          agreement_type?: 'platform_agreement' | 'managed_services_agreement';
          title: string;
          body_markdown: string;
          effective_at?: string;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          version?: string;
          agreement_type?: 'platform_agreement' | 'managed_services_agreement';
          title?: string;
          body_markdown?: string;
          effective_at?: string;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
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
          smtp_status: 'active' | 'throttled' | 'error' | 'disabled';
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
          smtp_status?: 'active' | 'throttled' | 'error' | 'disabled';
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
          smtp_status?: 'active' | 'throttled' | 'error' | 'disabled';
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
      mailbox_tags: {
        Row: {
          id: string;
          account_id: string;
          name: string;
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          name: string;
          color?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          name?: string;
          color?: string | null;
          created_at?: string;
        };
      };
      mailbox_tag_assignments: {
        Row: {
          mailbox_id: string;
          tag_id: string;
          account_id: string;
          created_at: string;
        };
        Insert: {
          mailbox_id: string;
          tag_id: string;
          account_id: string;
          created_at?: string;
        };
        Update: {
          mailbox_id?: string;
          tag_id?: string;
          account_id?: string;
          created_at?: string;
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
          conversation_status: string;
          conversation_status_source: string;
          classification_status: string;
          classification_requested_at: string | null;
          classification_completed_at: string | null;
          handling_metadata: Json | null;
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
          conversation_status?: string;
          conversation_status_source?: string;
          classification_status?: string;
          classification_requested_at?: string | null;
          classification_completed_at?: string | null;
          handling_metadata?: Json | null;
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
          conversation_status?: string;
          conversation_status_source?: string;
          classification_status?: string;
          classification_requested_at?: string | null;
          classification_completed_at?: string | null;
          handling_metadata?: Json | null;
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
      campaign_tags: {
        Row: {
          id: string;
          account_id: string;
          name: string;
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          name: string;
          color?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          name?: string;
          color?: string | null;
          created_at?: string;
        };
      };
      campaign_tag_assignments: {
        Row: {
          campaign_id: string;
          tag_id: string;
          account_id: string;
          created_at: string;
        };
        Insert: {
          campaign_id: string;
          tag_id: string;
          account_id: string;
          created_at?: string;
        };
        Update: {
          campaign_id?: string;
          tag_id?: string;
          account_id?: string;
          created_at?: string;
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
      api_import_jobs: {
        Row: {
          id: string;
          account_id: string;
          campaign_id: string | null;
          created_by_api_key_id: string | null;
          status: 'uploading' | 'queued' | 'running' | 'completed' | 'failed';
          progress: number;
          cursor: number;
          input: Json;
          result: Json;
          errors: Json;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          campaign_id?: string | null;
          created_by_api_key_id?: string | null;
          status?: 'uploading' | 'queued' | 'running' | 'completed' | 'failed';
          progress?: number;
          cursor?: number;
          input?: Json;
          result?: Json;
          errors?: Json;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          campaign_id?: string | null;
          created_by_api_key_id?: string | null;
          status?: 'uploading' | 'queued' | 'running' | 'completed' | 'failed';
          progress?: number;
          cursor?: number;
          input?: Json;
          result?: Json;
          errors?: Json;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      csv_import_staging: {
        Row: {
          id: string;
          job_id: string;
          account_id: string;
          row_index: number;
          payload: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          job_id: string;
          account_id: string;
          row_index: number;
          payload: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          job_id?: string;
          account_id?: string;
          row_index?: number;
          payload?: Json;
          created_at?: string;
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
      webhook_deliveries: {
        Row: {
          id: string;
          webhook_event_id: string;
          account_id: string;
          campaign_id: string | null;
          endpoint_url: string;
          event_type: string;
          status: 'pending' | 'sending' | 'delivered' | 'failed';
          attempt_count: number;
          request_body: Json;
          response_status: number | null;
          response_body: string | null;
          error: string | null;
          last_attempt_at: string | null;
          delivered_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          webhook_event_id: string;
          account_id: string;
          campaign_id?: string | null;
          endpoint_url: string;
          event_type: string;
          status?: 'pending' | 'sending' | 'delivered' | 'failed';
          attempt_count?: number;
          request_body?: Json;
          response_status?: number | null;
          response_body?: string | null;
          error?: string | null;
          last_attempt_at?: string | null;
          delivered_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          webhook_event_id?: string;
          account_id?: string;
          campaign_id?: string | null;
          endpoint_url?: string;
          event_type?: string;
          status?: 'pending' | 'sending' | 'delivered' | 'failed';
          attempt_count?: number;
          request_body?: Json;
          response_status?: number | null;
          response_body?: string | null;
          error?: string | null;
          last_attempt_at?: string | null;
          delivered_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      inbox_interactions: {
        Row: {
          id: string;
          account_id: string;
          thread_id: string;
          lead_id: string | null;
          trigger_message_id: string | null;
          classification_completed_at: string | null;
          suggestion_mode: 'manual' | 'ai' | null;
          suggestion_version: string | null;
          actor_type: 'user' | 'api';
          actor_user_id: string | null;
          actor_api_key_id: string | null;
          action: string;
          source: string;
          intent: Json | null;
          context: Json;
          changes: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          thread_id: string;
          lead_id?: string | null;
          trigger_message_id?: string | null;
          classification_completed_at?: string | null;
          suggestion_mode?: 'manual' | 'ai' | null;
          suggestion_version?: string | null;
          actor_type: 'user' | 'api';
          actor_user_id?: string | null;
          actor_api_key_id?: string | null;
          action: string;
          source: string;
          intent?: Json | null;
          context: Json;
          changes?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          thread_id?: string;
          lead_id?: string | null;
          trigger_message_id?: string | null;
          classification_completed_at?: string | null;
          suggestion_mode?: 'manual' | 'ai' | null;
          suggestion_version?: string | null;
          actor_type?: 'user' | 'api';
          actor_user_id?: string | null;
          actor_api_key_id?: string | null;
          action?: string;
          source?: string;
          intent?: Json | null;
          context?: Json;
          changes?: Json | null;
          created_at?: string;
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
      webhook_events: {
        Row: {
          id: string;
          account_id: string;
          campaign_id: string | null;
          event_type: string;
          payload: Json;
          dedupe_key: string | null;
          occurred_at: string;
          created_at: string;
          sqs_enqueued_at: string | null;
        };
        Insert: {
          id?: string;
          account_id: string;
          campaign_id?: string | null;
          event_type: string;
          payload?: Json;
          dedupe_key?: string | null;
          occurred_at?: string;
          created_at?: string;
          sqs_enqueued_at?: string | null;
        };
        Update: {
          id?: string;
          account_id?: string;
          campaign_id?: string | null;
          event_type?: string;
          payload?: Json;
          dedupe_key?: string | null;
          occurred_at?: string;
          created_at?: string;
          sqs_enqueued_at?: string | null;
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
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          user_agent?: string | null;
          last_seen_at?: string;
          revoked_at?: string | null;
          created_at?: string;
        };
      };
      thread_tag_assignments: {
        Row: {
          thread_id: string;
          tag_id: string;
          account_id: string;
          created_at: string;
        };
        Insert: {
          thread_id: string;
          tag_id: string;
          account_id: string;
          created_at?: string;
        };
        Update: {
          thread_id?: string;
          tag_id?: string;
          account_id?: string;
          created_at?: string;
        };
      };
      thread_tags: {
        Row: {
          id: string;
          account_id: string;
          name: string;
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          name: string;
          color?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          name?: string;
          color?: string | null;
          created_at?: string;
        };
      };
      apollo_enrichment_sessions: {
        Row: {
          id: string;
          account_id: string;
          global_lead_id: string;
          created_by: string | null;
          status: string;
          sync_suggestion: Json | null;
          phone_numbers: Json | null;
          expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          global_lead_id: string;
          created_by?: string | null;
          status: string;
          sync_suggestion?: Json | null;
          phone_numbers?: Json | null;
          expires_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          global_lead_id?: string;
          created_by?: string | null;
          status?: string;
          sync_suggestion?: Json | null;
          phone_numbers?: Json | null;
          expires_at?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      credit_ledger: {
        Row: {
          id: string;
          account_id: string;
          meter: string;
          delta: number;
          reason: string | null;
          ref_type: string | null;
          ref_id: string | null;
          created_by: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          meter: string;
          delta: number;
          reason?: string | null;
          ref_type?: string | null;
          ref_id?: string | null;
          created_by?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          meter?: string;
          delta?: number;
          reason?: string | null;
          ref_type?: string | null;
          ref_id?: string | null;
          created_by?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
      };
      credit_entitlements: {
        Row: {
          id: string;
          meter: string;
          account_id: string | null;
          monthly_grant: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          meter: string;
          account_id?: string | null;
          monthly_grant: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          meter?: string;
          account_id?: string | null;
          monthly_grant?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_credit_balance: {
        Args: {
          p_account_id: string;
          p_meter: string;
        };
        Returns: {
          used: number;
          remaining: number;
          credit_limit: number;
        }[];
      };
      consume_credit: {
        Args: {
          p_account_id: string;
          p_meter: string;
          p_amount?: number;
          p_reason?: string | null;
          p_ref_type?: string | null;
          p_ref_id?: string | null;
          p_created_by?: string | null;
          p_metadata?: Json | null;
        };
        Returns: {
          used: number;
          remaining: number;
          credit_limit: number;
        }[];
      };
      grant_credit: {
        Args: {
          p_account_id: string;
          p_meter: string;
          p_amount: number;
          p_reason?: string | null;
          p_ref_type?: string | null;
          p_ref_id?: string | null;
          p_created_by?: string | null;
          p_metadata?: Json | null;
        };
        Returns: {
          used: number;
          remaining: number;
          credit_limit: number;
        }[];
      };
      update_account_person_profile: {
        Args: {
          p_account_id: string;
          p_global_lead_id: string;
          p_updates: Json;
        };
        Returns: undefined;
      };
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
      pause_campaign_and_defer_jobs: {
        Args: {
          p_campaign_id: string;
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
      schedule_thread_ooo_resume: {
        Args: {
          p_thread_id: string;
          p_resume_at?: string | null;
          p_return_date?: string | null;
          p_mark_auto_reply?: boolean;
        };
        Returns: string;
      };
      process_due_out_of_office_resumes: {
        Args: {
          p_batch_size?: number;
        };
        Returns: number;
      };
      replace_lead_with_new_contact: {
        Args: {
          p_old_lead_id: string;
          p_new_email: string;
          p_new_name?: string | null;
          p_new_first_name?: string | null;
          p_new_last_name?: string | null;
          p_new_phone_number?: string | null;
          p_new_mobile_phone_number?: string | null;
          p_reason?: Database['public']['Enums']['replacement_reason_enum'];
          p_reason_note?: string | null;
          p_source_message_id?: string | null;
        };
        Returns: {
          replacement_id: string;
          new_lead_id: string;
          enrollment_id: string | null;
        }[];
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
      update_campaign_flow_data: {
        Args: {
          p_campaign_id: string;
          p_flow_data: Json;
          p_change_source?: string;
        };
        Returns: Database['public']['Tables']['campaigns']['Row'];
      };
      create_inbox_reply_job: {
        Args: {
          p_account_id: string;
          p_thread_id: string;
          p_in_reply_to_message_id: string;
          p_subject: string;
          p_body_text: string;
          p_body_html: string;
          p_to_email: string;
          p_to_name?: string | null;
          p_cc?: string[] | null;
          p_attachments?: Json | null;
        };
        Returns: string;
      };
      get_campaign_contacted_counts: {
        Args: {
          p_campaign_ids: string[];
        };
        Returns: {
          campaign_id: string;
          contacted_count: number;
        }[];
      };
      get_campaign_contacted_lead_ids: {
        Args: {
          p_campaign_id: string;
        };
        Returns: string[];
      };
      get_campaign_lead_progress_buckets: {
        Args: {
          p_campaign_id: string;
        };
        Returns: {
          total_leads: number;
          not_started: number;
          in_progress: number;
          paused: number;
          completed: number;
          stopped: number;
        }[];
      };
      enrollment_progress_state: {
        Args: {
          p_enrollment_state: string | null;
          p_enrollment_id: string | null;
        };
        Returns: string;
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
          mobile_phone_number: string | null;
          source: string | null;
          custom_lead_data: Json | null;
          created_at: string;
          total_count: number;
        }[];
      };
      add_global_leads_to_campaign: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_global_lead_ids: string[];
          p_options?: Json;
        };
        Returns: Json;
      };
      add_to_campaign_review_summary: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_global_lead_ids: string[];
        };
        Returns: Json;
      };
      import_api_leads_to_campaign: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_leads: Json;
          p_options?: Json;
        };
        Returns: Json;
      };
      preview_emails_in_campaigns: {
        Args: {
          p_account_id: string;
          p_campaign_ids: string[];
          p_emails: string[];
        };
        Returns: Json;
      };
      create_csv_lead_import_job: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
        };
        Returns: string;
      };
      append_csv_import_staging_rows: {
        Args: {
          p_job_id: string;
          p_rows: Json;
        };
        Returns: Json;
      };
      finalize_csv_lead_import_job: {
        Args: {
          p_job_id: string;
        };
        Returns: string;
      };
      delete_csv_import_staging_for_job: {
        Args: {
          p_job_id: string;
        };
        Returns: undefined;
      };
      backfill_account_lead_people_batch: {
        Args: {
          p_account_id?: string | null;
          p_limit?: number | null;
        };
        Returns: number;
      };
      get_account_import_job: {
        Args: {
          p_job_id: string;
        };
        Returns: Json;
      };
      start_leads_export_job: {
        Args: {
          p_account_id: string;
          p_source: string;
          p_global_lead_ids?: string[] | null;
          p_list_id?: string | null;
          p_query?: Json;
          p_column_layout?: Json;
          p_total_count?: number | null;
          p_filename_base?: string | null;
        };
        Returns: string;
      };
      start_add_to_campaign_job: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_global_lead_ids: string[];
        };
        Returns: string;
      };
      start_add_to_campaign_job_for_list: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_list_id: string;
        };
        Returns: string;
      };
      pause_enrollments_review_summary: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_global_lead_ids: string[];
        };
        Returns: Json;
      };
      resume_enrollments_review_summary: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_global_lead_ids: string[];
        };
        Returns: Json;
      };
      pause_enrollments_for_leads: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_global_lead_ids: string[];
        };
        Returns: Json;
      };
      resume_enrollments_for_leads: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_global_lead_ids: string[];
        };
        Returns: Json;
      };
      start_pause_enrollments_job: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_global_lead_ids: string[];
        };
        Returns: string;
      };
      start_resume_enrollments_job: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_global_lead_ids: string[];
        };
        Returns: string;
      };
      start_pause_enrollments_job_for_list: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_list_id: string;
        };
        Returns: string;
      };
      start_resume_enrollments_job_for_list: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_list_id: string;
        };
        Returns: string;
      };
      remove_from_campaign_review_summary: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_global_lead_ids: string[];
        };
        Returns: Json;
      };
      remove_from_all_campaigns_review_summary: {
        Args: {
          p_account_id: string;
          p_global_lead_ids: string[];
        };
        Returns: Json;
      };
      remove_global_leads_from_campaign: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_global_lead_ids: string[];
        };
        Returns: Json;
      };
      remove_global_leads_from_all_campaigns: {
        Args: {
          p_account_id: string;
          p_global_lead_ids: string[];
        };
        Returns: Json;
      };
      start_remove_from_campaign_job: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_global_lead_ids: string[];
        };
        Returns: string;
      };
      start_remove_from_all_campaigns_job: {
        Args: {
          p_account_id: string;
          p_global_lead_ids: string[];
        };
        Returns: string;
      };
      start_remove_from_campaign_job_for_list: {
        Args: {
          p_account_id: string;
          p_campaign_id: string;
          p_list_id: string;
        };
        Returns: string;
      };
      start_remove_from_all_campaigns_job_for_list: {
        Args: {
          p_account_id: string;
          p_list_id: string;
        };
        Returns: string;
      };
      lead_saved_list_member_counts: {
        Args: {
          p_account_id: string;
          p_list_ids?: string[] | null;
        };
        Returns: {
          list_id: string;
          lead_count: number;
        }[];
      };
      saved_list_membership_review_summary: {
        Args: {
          p_account_id: string;
          p_list_id: string;
          p_global_lead_ids: string[];
          p_mode: string;
        };
        Returns: Json;
      };
      saved_lead_list_people_page: {
        Args: {
          p_account_id: string;
          p_list_id: string;
          p_campaign_ids?: string[] | null;
          p_reply_statuses?: string[] | null;
          p_enrollment_states?: string[] | null;
          p_reply_categories?: string[] | null;
          p_search?: string | null;
          p_limit?: number | null;
          p_offset?: number | null;
          p_sort_column?: string | null;
          p_sort_direction?: string | null;
        };
        Returns: {
          global_lead_id: string;
          email: string | null;
          display_name: string | null;
          first_name: string | null;
          last_name: string | null;
          campaign_count: number;
          company_list: string | null;
          has_reply: boolean;
          latest_activity: string | null;
          newest_membership_created_at: string | null;
          total_count: number;
        }[];
      };
      account_lead_people_page: {
        Args: {
          p_account_id: string;
          p_global_lead_ids?: string[] | null;
          p_campaign_ids?: string[] | null;
          p_reply_statuses?: string[] | null;
          p_enrollment_states?: string[] | null;
          p_reply_categories?: string[] | null;
          p_search?: string | null;
          p_limit?: number | null;
          p_offset?: number | null;
          p_sort_column?: string | null;
          p_sort_direction?: string | null;
        };
        Returns: {
          global_lead_id: string;
          email: string | null;
          display_name: string | null;
          first_name: string | null;
          last_name: string | null;
          campaign_count: number;
          company_list: string | null;
          has_reply: boolean;
          latest_activity: string | null;
          newest_membership_created_at: string | null;
          total_count: number;
        }[];
      };
      account_outreach_metrics: {
        Args: {
          p_account_id: string;
          p_start_date: string;
          p_end_date: string;
          p_campaign_ids?: string[] | null;
        };
        Returns: {
          total_sent: number;
          total_positive_reply: number;
          leads_reached: number;
          leads_in_queue: number;
          smartlead_import_warning: boolean;
        }[];
      };
      account_outreach_stats_by_day: {
        Args: {
          p_account_id: string;
          p_start_date: string;
          p_end_date: string;
          p_campaign_ids?: string[] | null;
        };
        Returns: {
          stat_date: string;
          sent_count: number;
          replied_count: number;
          positive_reply_count: number;
          bounce_count: number;
        }[];
      };
      campaign_stats_by_day: {
        Args: { p_campaign_id: string; p_start_date: string; p_end_date: string };
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
      lead_replacement_status_enum: 'suggested' | 'confirmed' | 'completed' | 'cancelled';
      replacement_reason_enum: 'auto_reply_forward' | 'manual_referral' | 'wrong_contact' | 'role_change' | 'other';
    };
  };
}


