export const DEFAULT_SEED_SMART_HANDLING_MANUAL_CAMPAIGN_ID =
  'f0000000-0000-4000-8000-00000000e701';
export const DEFAULT_SEED_SMART_HANDLING_AI_CAMPAIGN_ID =
  'f0000000-0000-4000-8000-00000000e702';

export function smartHandlingCampaignIdShort(campaignId: string): string {
  return campaignId.replace(/-/g, '').slice(-6);
}

export function smartHandlingMailboxLocalPart(kind: 'manual' | 'ai', campaignId: string): string {
  return `smart-handling-${kind}-${smartHandlingCampaignIdShort(campaignId)}`;
}
