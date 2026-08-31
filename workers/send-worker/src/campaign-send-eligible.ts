export function isLifecycleSendEligibleCampaign(
  campaign: {
    status?: string | null;
    deleted_at?: string | null;
    start_at?: string | null;
    pause_at?: string | null;
  },
  now: Date = new Date(),
): boolean {
  if (campaign.deleted_at) return false;
  if (campaign.status !== 'running') return false;
  const nowMs = now.getTime();
  if (campaign.start_at) {
    const startMs = Date.parse(campaign.start_at);
    if (!Number.isNaN(startMs) && startMs > nowMs) return false;
  }
  if (campaign.pause_at) {
    const pauseMs = Date.parse(campaign.pause_at);
    if (!Number.isNaN(pauseMs) && nowMs >= pauseMs) return false;
  }
  return true;
}

export function shouldDeferReservedCampaignJob(
  campaign: {
    status?: string | null;
    deleted_at?: string | null;
    start_at?: string | null;
    pause_at?: string | null;
  },
  now: Date = new Date(),
): boolean {
  if (campaign.deleted_at) return false;
  if (campaign.status === 'stopped' || campaign.status === 'draft') return false;
  return !isLifecycleSendEligibleCampaign(campaign, now);
}
