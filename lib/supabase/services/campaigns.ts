import { supabase } from '../client';
import type { Campaign, CampaignInsert, CampaignUpdate, Database } from '../types';

/**
 * Campaign service for database operations
 * Handles all CRUD operations for campaigns
 */

export interface CampaignFilters {
  ownerId?: string;
  organizationId?: string | null;
}

/**
 * Get all campaigns with optional filters
 */
export async function getCampaigns(filters?: CampaignFilters): Promise<Campaign[]> {
  let query = supabase
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false }) as any;

  // Apply filters
  if (filters?.ownerId) {
    query = query.eq('owner_id', filters.ownerId);
  }

  if (filters?.organizationId !== undefined) {
    if (filters.organizationId === null) {
      query = query.is('organization_id', null);
    } else {
      query = query.eq('organization_id', filters.organizationId);
    }
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch campaigns: ${error.message}`);
  }

  return data || [];
}

/**
 * Get a single campaign by ID
 */
export async function getCampaignById(id: string): Promise<Campaign | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null;
    }
    throw new Error(`Failed to fetch campaign: ${error.message}`);
  }

  return data;
}

/**
 * Create a new campaign
 */
export async function createCampaign(campaign: CampaignInsert): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      ...campaign,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create campaign: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to create campaign: No data returned');
  }

  return data;
}

/**
 * Update a campaign
 */
export async function updateCampaign(
  id: string,
  updates: CampaignUpdate
): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update campaign: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to update campaign: No data returned');
  }

  return data;
}

/**
 * Delete a campaign
 */
export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete campaign: ${error.message}`);
  }
}

/**
 * Check if a user owns a campaign (for authorization)
 */
export async function isCampaignOwner(
  campaignId: string,
  userId: string
): Promise<boolean> {
  const campaign = await getCampaignById(campaignId);
  return campaign?.owner_id === userId;
}

/**
 * Check if a user or organization has access to a campaign
 */
export async function hasCampaignAccess(
  campaignId: string,
  userId: string,
  organizationId?: string | null
): Promise<boolean> {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) return false;

  // User is owner
  if (campaign.owner_id === userId) return true;

  // User belongs to the same organization
  if (campaign.organization_id && organizationId && campaign.organization_id === organizationId) {
    return true;
  }

  return false;
}

