import { supabase } from '../../client';
import type { Campaign } from '../../types';
import { getCampaigns, getCampaignById, deleteCampaign } from './campaigns';
import { deleteMailbox } from '../mailboxes';

/**
 * Get test campaigns for a user (campaigns with test mailboxes or test leads).
 */
export async function getTestCampaigns(userId: string): Promise<Campaign[]> {
  const allCampaigns = await getCampaigns({ ownerId: userId });
  if (allCampaigns.length === 0) return [];

  const campaignIds = allCampaigns.map((c) => c.id);
  const testCampaignIds = new Set<string>();

  const { data: mailboxData, error: mailboxError } = await supabase
    .from('campaign_mailboxes')
    .select('campaign_id, mailboxes!inner(email_address)')
    .in('campaign_id', campaignIds);

  if (!mailboxError && mailboxData) {
    mailboxData.forEach((item: any) => {
      if (item.mailboxes?.email_address?.endsWith('@furnace.test')) testCampaignIds.add(item.campaign_id);
    });
  }

  const { data: leadsData, error: leadsError } = await supabase
    .from('leads')
    .select('campaign_id, email')
    .is('deleted_at', null)
    .in('campaign_id', campaignIds);

  if (!leadsError && leadsData) {
    leadsData.forEach((lead: any) => {
      if (lead.email?.endsWith('@furnace.test')) testCampaignIds.add(lead.campaign_id);
    });
  }

  return allCampaigns
    .filter((c) => testCampaignIds.has(c.id))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Delete a test campaign and associated test-only mailboxes.
 */
export async function deleteTestCampaign(campaignId: string): Promise<void> {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const { data: campaignMailboxes, error: cmError } = await supabase
    .from('campaign_mailboxes')
    .select('mailbox_id, mailboxes!inner(email_address)')
    .eq('campaign_id', campaignId);

  if (cmError) throw new Error(`Failed to fetch campaign mailboxes: ${cmError.message}`);

  const testMailboxIds: string[] = [];
  if (campaignMailboxes) {
    for (const item of campaignMailboxes) {
      const mailbox = (item as any).mailboxes;
      if (mailbox?.email_address?.endsWith('@furnace.test')) testMailboxIds.push((item as any).mailbox_id);
    }
  }

  for (const mailboxId of testMailboxIds) {
    const { data: otherCampaigns, error: ocError } = await supabase
      .from('campaign_mailboxes')
      .select('campaign_id')
      .eq('mailbox_id', mailboxId)
      .neq('campaign_id', campaignId);

    if (ocError) {
      console.error(`Failed to check mailbox ${mailboxId} usage:`, ocError);
      continue;
    }
    if (!otherCampaigns || otherCampaigns.length === 0) {
      try {
        await deleteMailbox(mailboxId);
      } catch (error) {
        console.error(`Failed to delete test mailbox ${mailboxId}:`, error);
      }
    }
  }

  await deleteCampaign(campaignId);
}
