import { supabase } from '../client';
import type {
  SmartleadMigrationCampaign,
  SmartleadMigrationEvent,
  SmartleadMigrationRun,
} from '../types';

export interface SmartleadMigrationCampaignInput {
  id: number;
  name: string;
  created_at?: string | null;
}

const ACTIVE_RUN_STATUSES: SmartleadMigrationRun['status'][] = [
  'queued',
  'launching',
  'running',
  'cancel_requested',
];

export async function createSmartleadMigrationRun(params: {
  accountId: string;
  selectedCampaigns: SmartleadMigrationCampaignInput[];
}): Promise<string> {
  const payload = params.selectedCampaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    created_at: campaign.created_at ?? null,
  }));

  const { data, error } = await supabase.rpc('create_smartlead_migration_run', {
    p_account_id: params.accountId,
    p_selected_campaigns: payload,
  });

  if (error) {
    throw new Error(`Failed to create Smartlead migration run: ${error.message}`);
  }

  if (!data || typeof data !== 'string') {
    throw new Error('Failed to create Smartlead migration run: no run id returned.');
  }

  return data;
}

export async function cancelSmartleadMigrationRun(runId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('cancel_smartlead_migration_run', {
    p_run_id: runId,
  });

  if (error) {
    throw new Error(`Failed to cancel Smartlead migration run: ${error.message}`);
  }

  return data === true;
}

export async function getSmartleadMigrationRun(runId: string): Promise<SmartleadMigrationRun | null> {
  const { data, error } = await supabase
    .from('smartlead_migration_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch Smartlead migration run: ${error.message}`);
  }

  return data;
}

export async function getLatestSmartleadMigrationRun(
  accountId: string,
): Promise<SmartleadMigrationRun | null> {
  const { data, error } = await supabase
    .from('smartlead_migration_runs')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest Smartlead migration run: ${error.message}`);
  }

  return data;
}

export async function getActiveSmartleadMigrationRun(
  accountId: string,
): Promise<SmartleadMigrationRun | null> {
  const { data, error } = await supabase
    .from('smartlead_migration_runs')
    .select('*')
    .eq('account_id', accountId)
    .in('status', ACTIVE_RUN_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch active Smartlead migration run: ${error.message}`);
  }

  return data;
}

export async function listSmartleadMigrationCampaigns(
  runId: string,
): Promise<SmartleadMigrationCampaign[]> {
  const { data, error } = await supabase
    .from('smartlead_migration_campaigns')
    .select('*')
    .eq('run_id', runId)
    .order('order_index', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch Smartlead migration campaigns: ${error.message}`);
  }

  return data ?? [];
}

export async function listSmartleadMigrationEvents(
  runId: string,
  limit: number = 50,
): Promise<SmartleadMigrationEvent[]> {
  const { data, error } = await supabase
    .from('smartlead_migration_events')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch Smartlead migration events: ${error.message}`);
  }

  return data ?? [];
}
