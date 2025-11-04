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
          phone: string | null;
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
          phone?: string | null;
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
          phone?: string | null;
          source?: string | null;
          custom_lead_data?: Json | null;
          global_lead_id?: string | null;
          status?: 'new' | 'processing' | 'completed' | 'failed' | 'paused' | 'removed';
          created_at?: string;
          updated_at?: string;
        };
      };
      lead_states: {
        Row: {
          id: string;
          lead_id: string;
          campaign_id: string;
          node_id: string;
          node_type: 'leadSource' | 'email' | 'waitTime' | 'aiCategorizer' | 'dataSender';
          status: 'schrodinger' | 'queued' | 'processing' | 'processed' | 'failed' | 'success' | 'trimmed';
          parent_state_id: string | null;
          execution_data: Json | null;
          error_message: string | null;
          entered_at: string | null;
          queued_at: string | null;
          processing_at: string | null;
          completed_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lead_id: string;
          campaign_id: string;
          node_id: string;
          node_type: 'leadSource' | 'email' | 'waitTime' | 'aiCategorizer' | 'dataSender';
          status?: 'schrodinger' | 'queued' | 'processing' | 'processed' | 'failed' | 'success' | 'trimmed';
          parent_state_id?: string | null;
          execution_data?: Json | null;
          error_message?: string | null;
          entered_at?: string | null;
          queued_at?: string | null;
          processing_at?: string | null;
          completed_at?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          lead_id?: string;
          campaign_id?: string;
          node_id?: string;
          node_type?: 'leadSource' | 'email' | 'waitTime' | 'aiCategorizer' | 'dataSender';
          status?: 'schrodinger' | 'queued' | 'processing' | 'processed' | 'failed' | 'success' | 'trimmed';
          parent_state_id?: string | null;
          execution_data?: Json | null;
          error_message?: string | null;
          entered_at?: string | null;
          queued_at?: string | null;
          processing_at?: string | null;
          completed_at?: string | null;
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


