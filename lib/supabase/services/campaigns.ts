import { supabase } from '../client';
import type { Campaign, CampaignInsert, CampaignUpdate } from '../types';
import { getAccountMembershipsForUser, getUserByExternalId } from './users';

/**
 * Campaign service for database operations
 * Handles all CRUD operations for campaigns
 */

export interface CampaignFilters {
  ownerId?: string;
  accountId?: string;
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

  if (filters?.accountId) {
    query = query.eq('account_id', filters.accountId);
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

export interface CampaignStats {
  sentCount: number;
  repliedCount: number;
  positiveReplyCount: number;
  enrollmentCount: number;
}

/**
 * Get sent/replied/positive reply counts for multiple campaigns in one batch.
 */
export async function getCampaignStatsForCampaigns(
  campaignIds: string[]
): Promise<Record<string, CampaignStats>> {
  const result: Record<string, CampaignStats> = {};
  if (campaignIds.length === 0) return result;

  // Initialize all campaigns with zero stats
  for (const id of campaignIds) {
    result[id] = { sentCount: 0, repliedCount: 0, positiveReplyCount: 0, enrollmentCount: 0 };
  }

  // Enrollment count: total enrollments (emails to be sent)
  const { data: enrollmentRows } = await supabase
    .from('enrollments')
    .select('campaign_id')
    .in('campaign_id', campaignIds);

  if (enrollmentRows) {
    for (const row of enrollmentRows) {
      if (row.campaign_id && result[row.campaign_id]) {
        result[row.campaign_id].enrollmentCount++;
      }
    }
  }

  // Sent count: message_jobs with status='sent' and message_type in ('campaign', null)
  const { data: sentRows } = await supabase
    .from('message_jobs')
    .select('campaign_id')
    .in('campaign_id', campaignIds)
    .eq('status', 'sent')
    .or('message_type.eq.campaign,message_type.is.null');

  if (sentRows) {
    for (const row of sentRows) {
      if (row.campaign_id && result[row.campaign_id]) {
        result[row.campaign_id].sentCount++;
      }
    }
  }

  // Replied count: email_threads with has_reply=true
  const { data: repliedRows } = await supabase
    .from('email_threads')
    .select('campaign_id')
    .in('campaign_id', campaignIds)
    .eq('has_reply', true);

  if (repliedRows) {
    for (const row of repliedRows) {
      if (row.campaign_id && result[row.campaign_id]) {
        result[row.campaign_id].repliedCount++;
      }
    }
  }

  // Positive reply count: email_threads with category='Interested'
  const { data: positiveRows } = await supabase
    .from('email_threads')
    .select('campaign_id')
    .in('campaign_id', campaignIds)
    .eq('category', 'Interested');

  if (positiveRows) {
    for (const row of positiveRows) {
      if (row.campaign_id && result[row.campaign_id]) {
        result[row.campaign_id].positiveReplyCount++;
      }
    }
  }

  return result;
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
 * Ensure enrollments exist for campaign leads.
 * Uses conflict-safe upsert on (campaign_id, lead_id) and does not mutate existing rows.
 */
export async function ensureCampaignEnrollmentsForLeads(
  campaignId: string,
  leadIds: string[]
): Promise<void> {
  if (!leadIds.length) return;

  const rows = leadIds.map((leadId) => ({
    campaign_id: campaignId,
    lead_id: leadId,
    current_node_id: null,
    state: 'active',
    next_run_at: new Date().toISOString(),
    flow_position: {},
  }));

  const { error } = await supabase
    .from('enrollments')
    .upsert(rows as any, {
      onConflict: 'campaign_id,lead_id',
      ignoreDuplicates: true,
    });

  if (error) {
    throw new Error(`Failed to ensure campaign enrollments: ${error.message}`);
  }
}

/**
 * Backfill enrollments for all leads in a campaign.
 */
export async function backfillCampaignEnrollments(campaignId: string): Promise<void> {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id')
    .eq('campaign_id', campaignId);

  if (error) {
    throw new Error(`Failed to load campaign leads for enrollment backfill: ${error.message}`);
  }

  const leadIds = (leads || []).map((lead: any) => lead.id).filter(Boolean);
  await ensureCampaignEnrollmentsForLeads(campaignId, leadIds);
}

/**
 * Hard-pause cleanup: cancel unsent campaign jobs for a campaign.
 * Manual inbox jobs are intentionally excluded.
 */
export async function cancelUnsentCampaignJobs(
  campaignId: string,
  reason: string = 'Campaign paused'
): Promise<number> {
  const { data, error } = await supabase
    .from('message_jobs')
    .update({
      status: 'cancelled',
      error_message: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'reserved'])
    .or('message_type.eq.campaign,message_type.is.null')
    .select('id');

  if (error) {
    throw new Error(`Failed to cancel unsent campaign jobs: ${error.message}`);
  }

  return (data || []).length;
}

/**
 * Delete a campaign
 */
export async function deleteCampaign(id: string): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/28828e28-f092-4c58-9db7-7686778cf427',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'campaigns.ts:deleteCampaign',message:'Campaign delete invoked',data:{campaignId:id},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
  // #endregion
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
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/28828e28-f092-4c58-9db7-7686778cf427',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'campaigns.ts:deleteTestCampaign',message:'Test campaign delete invoked',data:{campaignId},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
  // #endregion
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

