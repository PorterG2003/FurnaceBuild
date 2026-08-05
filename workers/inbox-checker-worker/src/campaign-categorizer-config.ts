import type { SupabaseClient } from '@supabase/supabase-js';

export type CampaignCategorizerConfig = {
  hasCategorizer: boolean;
  useAi: boolean;
};

export type CampaignCategorizerConfigLoad =
  | { status: 'ok'; hasCategorizer: boolean; useAi: boolean }
  | { status: 'error'; error: string };

export async function loadCampaignCategorizerConfig(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<CampaignCategorizerConfigLoad> {
  const { data, error } = await supabase
    .from('nodes')
    .select('id, node_data')
    .eq('campaign_id', campaignId)
    .eq('node_type', 'aiCategorizer')
    .is('deleted_at', null)
    .limit(1);

  if (error) {
    console.error(`[INBOX CHECKER] Failed to check categorizer for campaign ${campaignId}:`, error);
    return { status: 'error', error: error.message };
  }

  const row = data?.[0] as { node_data?: Record<string, unknown> | null } | undefined;
  return {
    status: 'ok',
    hasCategorizer: (data?.length ?? 0) > 0,
    useAi: row?.node_data?.use_ai === true,
  };
}
