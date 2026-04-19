/**
 * Type definitions for scheduler worker
 */

export interface Enrollment {
  id: string;
  campaign_id: string;
  lead_id: string;
  current_node_id: string | null;
  current_flow_version_number?: number | null;
  state: 'active' | 'paused' | 'stopped' | 'completed';
  next_run_at: string | null;
  flow_position: Record<string, any>;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  flow_data: {
    nodes: any[];
    edges: any[];
  };
  current_flow_version_number?: number | null;
  schedule: CampaignSchedule | null;
  owner_id: string;
  sending_interval_seconds: number;
  deleted_at?: string | null;
  created_at: string;
}

export interface CampaignSchedule {
  timezone: string;
  start_hour: number;
  end_hour: number;
  days_of_week: number[] | null;
}

export interface Mailbox {
  id: string;
  account_id: string;
  email_address: string;
  display_name: string;
  smtp_status: string;
  status: string;
  deleted_at?: string | null;
}

export interface MessageJob {
  id: string;
  enrollment_id: string;
  campaign_id: string;
  lead_id: string;
  mailbox_id: string;
  node_id: string;
  interval_id?: string | null;
  status: string;
  scheduled_at: string;
  message_data: Record<string, any>;
}

export interface Lead {
  id: string;
  email: string;
  name: string;
  first_name?: string;
  last_name?: string;
  mailbox_id: string | null;
  deleted_at?: string | null;
  [key: string]: any;
}

