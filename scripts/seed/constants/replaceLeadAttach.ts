/** Fixed campaign id so re-runs are idempotent. */
export const DEFAULT_SEED_REPLACE_LEAD_ATTACH_CAMPAIGN_ID =
  'f0000000-0000-4000-8000-00000000e801';

export const REPLACE_LEAD_ATTACH_CAMPAIGN_NAME = 'Replace Lead Attach Smoke';

export const REPLACE_LEAD_ATTACH_SEED_SOURCE = 'seed:replace-lead-attach';

export const REPLACE_LEAD_ATTACH_DOMAIN = 'replace-attach.furnace.test';

export function replaceLeadAttachCampaignIdShort(campaignId: string): string {
  return campaignId.replace(/-/g, '').slice(-6);
}

export function replaceLeadAttachMailboxEmail(campaignId: string): string {
  return `replace-attach-${replaceLeadAttachCampaignIdShort(campaignId)}@furnace.test`;
}

export function replaceLeadAttachEmail(localPart: string): string {
  return `${localPart}@${REPLACE_LEAD_ATTACH_DOMAIN}`;
}
