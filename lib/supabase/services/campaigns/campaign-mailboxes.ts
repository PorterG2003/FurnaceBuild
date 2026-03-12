import { supabase } from '../../client';
import { getCampaignById } from './campaigns';

export async function assignMailboxesToCampaign(
  campaignId: string,
  mailboxIds: string[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('campaign_mailboxes')
    .delete()
    .eq('campaign_id', campaignId);

  if (deleteError) throw new Error(`Failed to remove existing mailbox assignments: ${deleteError.message}`);

  if (mailboxIds.length > 0) {
    const campaign = await getCampaignById(campaignId);
    const accountId = campaign?.account_id;
    if (!accountId) throw new Error('Campaign not found or missing account_id');
    const assignments = mailboxIds.map((mailboxId) => ({
      campaign_id: campaignId,
      mailbox_id: mailboxId,
      account_id: accountId,
    }));
    const { error: insertError } = await supabase.from('campaign_mailboxes').insert(assignments);
    if (insertError) throw new Error(`Failed to assign mailboxes to campaign: ${insertError.message}`);
  }
}

export async function getCampaignMailboxes(campaignId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('campaign_mailboxes')
    .select('mailbox:mailboxes(*)')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch campaign mailboxes: ${error.message}`);
  return (data || []).map((item: any) => item.mailbox);
}
