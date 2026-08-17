import { supabase } from '../../client';
import { sumUniqueMailboxDailyLimits, type QueueSendCapacity } from '@/lib/metrics/queueSendCapacity';

const EMPTY_CAPACITY: QueueSendCapacity = { dailyEmails: 0, mailboxCount: 0 };

/**
 * Live send capacity for queue runway: unique mailboxes on running Furnace
 * campaigns, each counted once at COALESCE(daily_limit, 50).
 */
export async function getAccountQueueSendCapacity(
  accountId: string,
  campaignIds?: string[] | null,
): Promise<QueueSendCapacity> {
  let campaignQuery = supabase
    .from('campaigns')
    .select('id')
    .eq('account_id', accountId)
    .eq('status', 'running')
    .is('deleted_at', null)
    .or('source.is.null,source.neq.smartlead');

  if (campaignIds != null && campaignIds.length > 0) {
    campaignQuery = campaignQuery.in('id', campaignIds);
  }

  const { data: campaigns, error: campaignError } = await campaignQuery;
  if (campaignError) {
    throw new Error(`Failed to load running campaigns: ${campaignError.message}`);
  }
  const runningIds = (campaigns ?? []).map((row) => row.id);
  if (runningIds.length === 0) return EMPTY_CAPACITY;

  const { data: assignments, error: assignmentError } = await supabase
    .from('campaign_mailboxes')
    .select('mailbox_id')
    .eq('account_id', accountId)
    .in('campaign_id', runningIds);
  if (assignmentError) {
    throw new Error(`Failed to load campaign mailboxes: ${assignmentError.message}`);
  }

  const mailboxIds = [...new Set((assignments ?? []).map((row) => row.mailbox_id).filter(Boolean))];
  if (mailboxIds.length === 0) return EMPTY_CAPACITY;

  const { data: mailboxes, error: mailboxError } = await supabase
    .from('mailboxes')
    .select('id, daily_limit')
    .is('deleted_at', null)
    .in('id', mailboxIds);
  if (mailboxError) {
    throw new Error(`Failed to load mailboxes: ${mailboxError.message}`);
  }

  return sumUniqueMailboxDailyLimits(mailboxes ?? []);
}
