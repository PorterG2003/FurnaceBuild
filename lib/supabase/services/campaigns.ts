import { supabase } from '../client';
import type { Campaign, CampaignInsert, CampaignUpdate } from '../types';
import { getAccountMembershipsForUser, getUserByExternalId } from './users';

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
 * Automatically sets account_id based on owner_id if not provided
 */
export async function createCampaign(campaign: CampaignInsert): Promise<Campaign> {
  // If account_id is not provided, look it up from owner_id
  let accountId = campaign.account_id;
  
  if (!accountId && campaign.owner_id) {
    try {
      // Get user by external_id (Cognito user ID)
      const user = await getUserByExternalId(campaign.owner_id);
      if (user) {
        // Get user's account memberships
        const memberships = await getAccountMembershipsForUser(user.id);
        // Use primary account (owner account, or first one)
        const primaryMembership = memberships.find(m => m.membership.is_owner) || memberships[0];
        if (primaryMembership) {
          accountId = primaryMembership.account.id;
        }
      }
    } catch (error) {
      console.error('Failed to auto-resolve account_id for campaign:', error);
      // Throw error - account_id is required for scheduler to work
      throw new Error(`Failed to resolve account_id for campaign owner ${campaign.owner_id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // Ensure account_id is set
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

  if (error) {
    throw new Error(`Failed to create campaign: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to create campaign: No data returned');
  }

  return data;
}

/**
 * Assign mailboxes to a campaign
 * Replaces any existing mailbox assignments
 */
export async function assignMailboxesToCampaign(
  campaignId: string,
  mailboxIds: string[]
): Promise<void> {
  // Delete existing assignments
  const { error: deleteError } = await supabase
    .from('campaign_mailboxes')
    .delete()
    .eq('campaign_id', campaignId);

  if (deleteError) {
    throw new Error(`Failed to remove existing mailbox assignments: ${deleteError.message}`);
  }

  // Insert new assignments
  if (mailboxIds.length > 0) {
    const assignments = mailboxIds.map(mailboxId => ({
      campaign_id: campaignId,
      mailbox_id: mailboxId,
    }));

    const { error: insertError } = await supabase
      .from('campaign_mailboxes')
      .insert(assignments);

    if (insertError) {
      throw new Error(`Failed to assign mailboxes to campaign: ${insertError.message}`);
    }
  }
}

/**
 * Get mailboxes assigned to a campaign
 */
export async function getCampaignMailboxes(campaignId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('campaign_mailboxes')
    .select(`
      mailbox:mailboxes(*)
    `)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch campaign mailboxes: ${error.message}`);
  }

  return (data || []).map((item: any) => item.mailbox);
}

/**
 * Get test campaigns for a user
 * Returns campaigns that have test mailboxes OR test leads (email pattern @furnace.test)
 */
export async function getTestCampaigns(userId: string): Promise<Campaign[]> {
  // Get all campaigns for the user first
  const allCampaigns = await getCampaigns({ ownerId: userId });
  
  if (allCampaigns.length === 0) {
    return [];
  }

  const campaignIds = allCampaigns.map(c => c.id);
  const testCampaignIds = new Set<string>();

  // Check campaigns with test mailboxes
  const { data: mailboxData, error: mailboxError } = await supabase
    .from('campaign_mailboxes')
    .select('campaign_id, mailboxes!inner(email_address)')
    .in('campaign_id', campaignIds);

  if (!mailboxError && mailboxData) {
    mailboxData.forEach((item: any) => {
      if (item.mailboxes?.email_address?.endsWith('@furnace.test')) {
        testCampaignIds.add(item.campaign_id);
      }
    });
  }

  // Check campaigns with test leads
  const { data: leadsData, error: leadsError } = await supabase
    .from('leads')
    .select('campaign_id, email')
    .in('campaign_id', campaignIds);

  if (!leadsError && leadsData) {
    leadsData.forEach((lead: any) => {
      if (lead.email?.endsWith('@furnace.test')) {
        testCampaignIds.add(lead.campaign_id);
      }
    });
  }

  // Return test campaigns, sorted by created_at descending
  return allCampaigns
    .filter(c => testCampaignIds.has(c.id))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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
 * Delete a test campaign and all associated test data
 * This function:
 * 1. Deletes test mailboxes that are ONLY used by this campaign
 * 2. Deletes the campaign (which cascades to: leads, enrollments, message_jobs, events, nodes, campaign_mailboxes, email_threads)
 */
export async function deleteTestCampaign(campaignId: string): Promise<void> {
  // Verify campaign exists
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`);
  }

  // Get all mailboxes assigned to this campaign
  const { data: campaignMailboxes, error: cmError } = await supabase
    .from('campaign_mailboxes')
    .select('mailbox_id, mailboxes!inner(email_address)')
    .eq('campaign_id', campaignId);

  if (cmError) {
    throw new Error(`Failed to fetch campaign mailboxes: ${cmError.message}`);
  }

  // Find test mailboxes (email ends with @furnace.test)
  const testMailboxIds: string[] = [];
  if (campaignMailboxes) {
    for (const item of campaignMailboxes) {
      const mailbox = (item as any).mailboxes;
      if (mailbox?.email_address?.endsWith('@furnace.test')) {
        testMailboxIds.push((item as any).mailbox_id);
      }
    }
  }

  // For each test mailbox, check if it's used by other campaigns
  // If it's only used by this campaign, delete it
  for (const mailboxId of testMailboxIds) {
    const { data: otherCampaigns, error: ocError } = await supabase
      .from('campaign_mailboxes')
      .select('campaign_id')
      .eq('mailbox_id', mailboxId)
      .neq('campaign_id', campaignId);

    if (ocError) {
      console.error(`Failed to check mailbox ${mailboxId} usage:`, ocError);
      // Continue with deletion - worst case we keep an orphaned test mailbox
      continue;
    }

    // If mailbox is only used by this campaign, delete it
    if (!otherCampaigns || otherCampaigns.length === 0) {
      const { error: deleteError } = await supabase
        .from('mailboxes')
        .delete()
        .eq('id', mailboxId);

      if (deleteError) {
        console.error(`Failed to delete test mailbox ${mailboxId}:`, deleteError);
        // Continue - the campaign_mailboxes relationship will still be deleted via cascade
      }
    }
  }

  // Delete the campaign - this will cascade delete:
  // - campaign_mailboxes (junction table)
  // - leads (with campaign_id)
  // - enrollments (with campaign_id)
  // - message_jobs (with campaign_id)
  // - events (with campaign_id)
  // - nodes (with campaign_id)
  // - email_threads (with campaign_id)
  const { error: deleteError } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', campaignId);

  if (deleteError) {
    throw new Error(`Failed to delete campaign: ${deleteError.message}`);
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

