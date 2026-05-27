import type { CampaignTag } from '@/lib/supabase/services/campaign-tags';
import type { CampaignListSummary } from '@/lib/supabase/services/campaigns';

export interface CampaignListFilters {
  statuses: CampaignListSummary['status'][];
  tagIds: string[];
}

export const EMPTY_CAMPAIGN_LIST_FILTERS: CampaignListFilters = {
  statuses: [],
  tagIds: [],
};

export function countActiveCampaignListFilters(filters: CampaignListFilters): number {
  return (filters.statuses.length > 0 ? 1 : 0) + (filters.tagIds.length > 0 ? 1 : 0);
}

export function filterCampaigns(
  campaigns: CampaignListSummary[],
  searchQuery: string,
  filters: CampaignListFilters,
  campaignTagsMap: Record<string, CampaignTag[]>,
): CampaignListSummary[] {
  const search = searchQuery.trim().toLowerCase();
  return campaigns.filter((campaign) => {
    if (search && !campaign.name.toLowerCase().includes(search)) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(campaign.status)) return false;
    if (filters.tagIds.length > 0) {
      const campaignTagIds = new Set((campaignTagsMap[campaign.id] ?? []).map((t) => t.id));
      const hasAny = filters.tagIds.some((id) => campaignTagIds.has(id));
      if (!hasAny) return false;
    }
    return true;
  });
}
