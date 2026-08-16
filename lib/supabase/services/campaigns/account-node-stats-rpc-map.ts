export interface AccountNodeStatRow {
  campaignId: string;
  campaignName: string;
  nodeId: string;
  flowNodeId: string | null;
  nodeLabel: string;
  sent: number;
  replied: number;
  positiveReply: number;
  bounced: number;
}

export type AccountNodeStatsRpcRow = {
  campaign_id: string;
  campaign_name: string | null;
  node_id: string;
  flow_node_id: string | null;
  node_label: string | null;
  sent_count: number | string | null;
  replied_count: number | string | null;
  positive_reply_count: number | string | null;
  bounce_count: number | string | null;
};

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export function mapAccountNodeStatsRows(rows: AccountNodeStatsRpcRow[]): AccountNodeStatRow[] {
  return rows.map((r) => ({
    campaignId: r.campaign_id,
    campaignName: r.campaign_name ?? 'Campaign',
    nodeId: r.node_id,
    flowNodeId: r.flow_node_id,
    nodeLabel: r.node_label?.trim() || 'Email step',
    sent: num(r.sent_count),
    replied: num(r.replied_count),
    positiveReply: num(r.positive_reply_count),
    bounced: num(r.bounce_count),
  }));
}
