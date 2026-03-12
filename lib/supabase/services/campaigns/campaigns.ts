import { reportErrorToSlack } from '../../../slack/reportErrorToSlack';
import { supabase } from '../../client';
import type { Campaign, CampaignInsert, CampaignUpdate } from '../../types';
import { getAccountMembershipsForUser, getUserById, getUserByExternalId } from '../accounts';

export interface CampaignFilters {
  ownerId?: string;
  accountId?: string;
  organizationId?: string | null;
}

export async function getCampaigns(filters?: CampaignFilters): Promise<Campaign[]> {
  let query = supabase
    .from('campaigns')
    .select('*')
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
    .select()
    .single();
  if (error) throw new Error(`Failed to update campaign: ${error.message}`);
  if (!data) throw new Error('Failed to update campaign: No data returned');
  return data;
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase.from('campaigns').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete campaign: ${error.message}`);
}
