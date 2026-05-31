import type { SupabaseClient } from '@supabase/supabase-js';
import { reportErrorToSlack } from '../../../slack/reportErrorToSlack';
import { supabase } from '../../client';
import type { Campaign, CampaignFlowVersion, CampaignInsert, CampaignUpdate } from '../../types';
import type { Database } from '../../types/database';
import { getAccountMembershipsForUser, getUserById, getUserByExternalId } from '../accounts';
import {
  duplicateCampaignWithClient,
  type DuplicateCampaignOptions,
} from './duplicate-campaign-with-client';

export type { CampaignFlowVersion };
export type { DuplicateCampaignOptions };

export interface CampaignFilters {
  ownerId?: string;
  accountId?: string;
  organizationId?: string | null;
}

export async function getCampaigns(filters?: CampaignFilters): Promise<Campaign[]> {
  let query = supabase
    .from('campaigns')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false }) as any;

  if (filters?.ownerId) query = query.eq('owner_id', filters.ownerId);
  if (filters?.accountId) query = query.eq('account_id', filters.accountId);
  if (filters?.organizationId !== undefined) {
    if (filters.organizationId === null) query = query.is('organization_id', null);
    else query = query.eq('organization_id', filters.organizationId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch campaigns: ${error.message}`);
  return data || [];
}

export async function getCampaignById(id: string): Promise<Campaign | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch campaign: ${error.message}`);
  }
  return data;
}

export async function createCampaign(campaign: CampaignInsert): Promise<Campaign> {
  let accountId = campaign.account_id;
  if (!accountId && campaign.owner_id) {
    try {
      const user = await getUserById(campaign.owner_id) ?? await getUserByExternalId(campaign.owner_id);
      if (user) {
        const memberships = await getAccountMembershipsForUser(user.id);
        const primaryMembership = memberships.find((m) => m.membership.is_owner) || memberships[0];
        if (primaryMembership) accountId = primaryMembership.account.id;
      }
    } catch (error) {
      console.error('Failed to auto-resolve account_id for campaign:', error);
      const msg = error instanceof Error ? error.message : String(error);
      reportErrorToSlack('Failed to auto-resolve account_id for campaign', { severity: 'warning', owner_id: campaign.owner_id ?? '', error: msg });
      throw new Error(`Failed to resolve account_id for campaign owner ${campaign.owner_id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  if (!accountId) {
    throw new Error('Campaign must have an account_id. Provide account_id directly or ensure owner_id has an associated account.');
  }

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      ...campaign,
      account_id: accountId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create campaign: ${error.message}`);
  if (!data) throw new Error('Failed to create campaign: No data returned');
  return data;
}

export async function updateCampaign(id: string, updates: CampaignUpdate): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();
  if (error) throw new Error(`Failed to update campaign: ${error.message}`);
  if (!data) throw new Error('Failed to update campaign: No data returned');
  return data;
}

export async function updateCampaignFlowData(
  id: string,
  flowData: Campaign['flow_data'],
  changeSource: string = 'builder'
): Promise<Campaign> {
  const { data, error } = await supabase.rpc('update_campaign_flow_data', {
    p_campaign_id: id,
    p_flow_data: flowData,
    p_change_source: changeSource,
  });

  if (error) throw new Error(`Failed to update campaign flow: ${error.message}`);
  const campaign = Array.isArray(data) ? data[0] : data;
  if (!campaign) throw new Error('Failed to update campaign flow: No data returned');
  return campaign as Campaign;
}

export async function getCampaignFlowVersions(campaignId: string): Promise<CampaignFlowVersion[]> {
  const { data, error } = await supabase
    .from('campaign_flow_versions')
    .select('id, campaign_id, account_id, version_number, flow_data, flow_hash, changed_at, changed_by_user_id, change_source, created_at')
    .eq('campaign_id', campaignId)
    .order('version_number', { ascending: false });

  if (error) throw new Error(`Failed to fetch campaign flow versions: ${error.message}`);
  return (data || []) as CampaignFlowVersion[];
}

export async function deleteCampaign(id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('campaigns')
    .update({
      deleted_at: now,
      status: 'stopped',
      updated_at: now,
    })
    .eq('id', id)
    .is('deleted_at', null);

  if (error) throw new Error(`Failed to delete campaign: ${error.message}`);

  const [enrollmentsResult, nodesResult] = await Promise.all([
    supabase
      .from('enrollments')
      .update({
        deleted_at: now,
        state: 'stopped',
        next_run_at: null,
        updated_at: now,
      })
      .eq('campaign_id', id)
      .is('deleted_at', null),
    supabase
      .from('nodes')
      .update({
        deleted_at: now,
        updated_at: now,
      })
      .eq('campaign_id', id)
      .is('deleted_at', null),
  ]);

  if (enrollmentsResult.error) {
    throw new Error(`Failed to delete campaign enrollments: ${enrollmentsResult.error.message}`);
  }
  if (nodesResult.error) {
    throw new Error(`Failed to delete campaign nodes: ${nodesResult.error.message}`);
  }
}

export async function duplicateCampaign(
  sourceCampaignId: string,
  options: DuplicateCampaignOptions,
): Promise<Campaign> {
  return duplicateCampaignWithClient(supabase as SupabaseClient<Database>, sourceCampaignId, options);
}
