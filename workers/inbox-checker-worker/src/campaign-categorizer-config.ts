import type { SupabaseClient } from '@supabase/supabase-js';

export type CampaignCategorizerConfig = {
  hasCategorizer: boolean;
  useAi: boolean;
};

export async function loadCampaignCategorizerConfig(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<CampaignCategorizerConfig> {
  const { data, error } = await supabase
    .from('nodes')
    .select('id, node_data')
    .eq('campaign_id', campaignId)
    .eq('node_type', 'aiCategorizer')
    .is('deleted_at', null)
    .limit(1);

  if (error) {
    // Fail open to the legacy stop path; callers should not block reply handling
    // or recovery work if a categorizer lookup fails.
    console.error(`[INBOX CHECKER] Failed to check categorizer for campaign ${campaignId}:`, error);
    return { hasCategorizer: false, useAi: false };
  }

  const row = data?.[0] as { node_data?: Record<string, unknown> | null } | undefined;
  return {
    hasCategorizer: (data?.length ?? 0) > 0,
    useAi: row?.node_data?.use_ai === true,
  };
}
