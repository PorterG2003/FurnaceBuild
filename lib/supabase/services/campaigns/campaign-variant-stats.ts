import { supabase } from '../../client';

export interface CampaignVariantStatRow {
  nodeId: string;
  flowNodeId: string | null;
  variantId: string;
  sent: number;
  replied: number;
  positiveReply: number;
  bounced: number;
}

/**
 * Per email node and variant stats for the campaign detail page.
 */
export async function getCampaignVariantStats(
  campaignId: string
): Promise<CampaignVariantStatRow[]> {
  const { data: statsRows, error: statsError } = await supabase.rpc('get_campaign_variant_stats', {
    p_campaign_id: campaignId,
  });

  if (statsError) {
    throw new Error(`get_campaign_variant_stats failed: ${statsError.message}`);
  }

  const { data: nodeRows, error: nodeError } = await supabase
    .from('nodes')
    .select('id, flow_node_id, node_type')
    .eq('campaign_id', campaignId)
    .is('deleted_at', null);

  if (nodeError) {
    throw new Error(`nodes lookup failed: ${nodeError.message}`);
  }

  const nodeIdToFlow = new Map<string, string | null>();
  for (const n of nodeRows || []) {
    nodeIdToFlow.set(n.id as string, (n as { flow_node_id?: string }).flow_node_id ?? null);
  }

  const rows = (statsRows || []) as Array<{
    node_id: string;
    variant_id: string;
    sent_count: number;
    replied_count: number;
    positive_reply_count: number;
    bounce_count: number;
  }>;

  return rows.map((r) => ({
    nodeId: r.node_id,
    flowNodeId: nodeIdToFlow.get(r.node_id) ?? null,
    variantId: r.variant_id,
    sent: Number(r.sent_count ?? 0),
    replied: Number(r.replied_count ?? 0),
    positiveReply: Number(r.positive_reply_count ?? 0),
    bounced: Number(r.bounce_count ?? 0),
  }));
}
