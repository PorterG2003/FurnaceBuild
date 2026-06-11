import {
  calculateNextAllowedTime,
  findMostRecentScheduleStart,
} from './schedule.js';

export async function calculateNextMailboxSendTime(
  campaignId,
  mailboxId,
  currentTime,
  campaignSchedule,
  supabase,
) {
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('sending_interval_seconds, created_at')
    .eq('id', campaignId)
    .single();

  if (campaignError || !campaign) {
    throw new Error(`Campaign ${campaignId} not found: ${campaignError?.message || 'Campaign not found'}`);
  }

  const intervalSeconds = campaign.sending_interval_seconds;
  const campaignStartTime = new Date(campaign.created_at);

  if (!intervalSeconds || intervalSeconds <= 0) {
    throw new Error(`Campaign ${campaignId} does not have a valid sending_interval_seconds configured`);
  }

  let campaignIntervalBaseTime;

  if (!campaignSchedule) {
    const timeSinceStart = currentTime.getTime() - campaignStartTime.getTime();
    const intervalsElapsed = Math.floor(timeSinceStart / (intervalSeconds * 1000));
    const nextSlotTime = campaignStartTime.getTime() + (intervalsElapsed + 1) * intervalSeconds * 1000;
    campaignIntervalBaseTime = new Date(nextSlotTime);
  } else {
    const mostRecentScheduleStart = findMostRecentScheduleStart(currentTime, campaignSchedule);
    const timeSinceScheduleStart = currentTime.getTime() - mostRecentScheduleStart.getTime();
    const intervalsElapsed = Math.floor(timeSinceScheduleStart / (intervalSeconds * 1000));
    const nextSlotTime = mostRecentScheduleStart.getTime() + (intervalsElapsed + 1) * intervalSeconds * 1000;
    const slotBasedTime = new Date(nextSlotTime);

    try {
      campaignIntervalBaseTime = calculateNextAllowedTime(slotBasedTime, campaignSchedule);
    } catch (error) {
      throw new Error(
        `Failed to calculate next allowed time for schedule: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const { data: throttle, error: throttleError } = await supabase
    .from('mailbox_throttles')
    .select('min_gap_seconds')
    .eq('mailbox_id', mailboxId)
    .eq('date', new Date().toISOString().split('T')[0])
    .maybeSingle();

  if (throttleError) {
    throw new Error(`Failed to query mailbox throttle for mailbox ${mailboxId}: ${throttleError.message}`);
  }

  const minGapSeconds = throttle?.min_gap_seconds ?? 180;

  const { data: lastJob, error: queryError } = await supabase
    .from('message_jobs')
    .select('scheduled_at')
    .eq('campaign_id', campaignId)
    .eq('mailbox_id', mailboxId)
    .in('status', ['queued', 'reserved', 'sending', 'sent'])
    .order('scheduled_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (queryError) {
    throw new Error(
      `Failed to query last scheduled time for mailbox ${mailboxId} in campaign ${campaignId}: ${queryError.message}`,
    );
  }

  const lastScheduledTime = lastJob?.scheduled_at ? new Date(lastJob.scheduled_at) : null;

  let mailboxMinTime;

  if (!lastScheduledTime) {
    mailboxMinTime = campaignIntervalBaseTime;
  } else {
    mailboxMinTime = new Date(lastScheduledTime.getTime() + minGapSeconds * 1000);

    if (mailboxMinTime < currentTime) {
      throw new Error(
        `Calculated mailboxMinTime (${mailboxMinTime}) is in the past. Last scheduled: ${lastScheduledTime}, Min gap: ${minGapSeconds}s, Current: ${currentTime}`,
      );
    }
  }

  let baseTime =
    campaignIntervalBaseTime > mailboxMinTime ? campaignIntervalBaseTime : mailboxMinTime;

  if (baseTime < currentTime) {
    baseTime = currentTime;
  }

  return baseTime;
}
