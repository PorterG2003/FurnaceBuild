import { getCampaignById } from './campaigns';

export async function isCampaignOwner(campaignId: string, userId: string): Promise<boolean> {
  const campaign = await getCampaignById(campaignId);
  return campaign?.owner_id === userId;
}

export async function hasCampaignAccess(
  campaignId: string,
  userId: string,
  organizationId?: string | null
): Promise<boolean> {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) return false;
  if (campaign.owner_id === userId) return true;
  if (campaign.organization_id && organizationId && campaign.organization_id === organizationId) {
    return true;
  }
  return false;
}
