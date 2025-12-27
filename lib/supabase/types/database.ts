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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
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
          locked: boolean;
          flow_data: Json | null;
          bucket_id: string;
          status: 'draft' | 'running' | 'paused' | 'stopped';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          owner_id: string;
          organization_id?: string | null;
          locked?: boolean;
          flow_data?: Json | null;
          bucket_id?: string;
          status?: 'draft' | 'running' | 'paused' | 'stopped';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          owner_id?: string;
          organization_id?: string | null;
          locked?: boolean;
          flow_data?: Json | null;
          bucket_id?: string;
          status?: 'draft' | 'running' | 'paused' | 'stopped';
          created_at?: string;
          updated_at?: string;
        };
      };
      leads: {
        Row: {
          id: string;
          campaign_id: string;
          bucket_id: string;
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
      };
      // lead_states removed - replaced by enrollments
      // lead_states: { ... }
      users: {
        Row: {
          id: string;
          external_id: string;
          email: string;
          name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          external_id: string;
          email: string;
          name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          external_id?: string;
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
          sync_enabled: boolean;
          last_synced_at: string | null;
          error_message: string | null;
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
          sync_enabled?: boolean;
          last_synced_at?: string | null;
          error_message?: string | null;
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
          sync_enabled?: boolean;
          last_synced_at?: string | null;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
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


