/**
 * Prune orphan edges from campaigns.flow_data (edges whose source/target are
 * missing from flow_data.nodes). Matches client normalizeFlowData + SQL
 * internal_flow_data_without_orphan_edges.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/repair-orphan-flow-edges.ts
 *   CAMPAIGN_ID=<uuid> npx tsx scripts/repair-orphan-flow-edges.ts
 *   APPLY=true npx tsx scripts/repair-orphan-flow-edges.ts
 */

import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

const CAMPAIGN_PAGE_SIZE = 200;

type FlowEdge = { id?: string; source?: string; target?: string; [key: string]: unknown };
type FlowNode = { id?: string; [key: string]: unknown };
type FlowData = { nodes?: FlowNode[]; edges?: FlowEdge[]; [key: string]: unknown };

type CampaignRow = {
  id: string;
  name: string | null;
  status: string | null;
  flow_data: FlowData | null;
};

type SupabaseClient = Awaited<ReturnType<typeof import('@supabase/supabase-js').createClient>>;

function pruneOrphanEdges(flowData: FlowData | null): {
  next: FlowData | null;
  removed: FlowEdge[];
} {
  if (!flowData || !Array.isArray(flowData.edges)) {
    return { next: flowData, removed: [] };
  }
  const nodeIds = new Set(
    (Array.isArray(flowData.nodes) ? flowData.nodes : [])
      .map((node) => (typeof node.id === 'string' ? node.id.trim() : ''))
      .filter(Boolean),
  );
  const kept: FlowEdge[] = [];
  const removed: FlowEdge[] = [];
  for (const edge of flowData.edges) {
    const source = typeof edge.source === 'string' ? edge.source.trim() : '';
    const target = typeof edge.target === 'string' ? edge.target.trim() : '';
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) {
      removed.push(edge);
      continue;
    }
    kept.push(edge);
  }
  if (removed.length === 0) {
    return { next: flowData, removed };
  }
  return {
    next: { ...flowData, edges: kept },
    removed,
  };
}

async function fetchCampaigns(
  supabase: SupabaseClient,
  campaignId: string | null,
): Promise<CampaignRow[]> {
  if (campaignId) {
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, name, status, flow_data, deleted_at')
      .eq('id', campaignId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load campaign: ${error.message}`);
    if (!data || data.deleted_at) throw new Error('Campaign not found or soft-deleted.');
    return [
      {
        id: data.id as string,
        name: (data.name as string | null) ?? null,
        status: (data.status as string | null) ?? null,
        flow_data: (data.flow_data as FlowData | null) ?? null,
      },
    ];
  }

  const rows: CampaignRow[] = [];
  for (let offset = 0; ; offset += CAMPAIGN_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, name, status, flow_data')
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(offset, offset + CAMPAIGN_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load campaigns: ${error.message}`);
    const page = (data ?? []) as CampaignRow[];
    rows.push(...page);
    if (page.length < CAMPAIGN_PAGE_SIZE) break;
  }
  return rows;
}

async function main() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const campaignIdFilter = process.env.CAMPAIGN_ID?.trim() || null;
  const apply = process.env.APPLY === 'true';
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  let key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    null;
  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);

  if (secretParamPath) {
    try {
      key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
      process.env.SUPABASE_SECRET_KEY = key;
    } catch (error) {
      if (!key) throw error;
      console.warn(
        `[repair-orphan-flow-edges] Failed to fetch ${secretParamPath}; falling back to existing secret env.`,
      );
    }
  }

  if (!url || !key) {
    console.error('Missing Supabase configuration.');
    process.exit(1);
  }

  console.log(`Target env: ${targetEnv}`);
  console.log(`Resolved SUPABASE_URL from ${urlSource}.`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(
    campaignIdFilter
      ? `Campaign filter: ${campaignIdFilter}`
      : 'Campaign filter: all non-deleted campaigns',
  );

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const campaigns = await fetchCampaigns(supabase, campaignIdFilter);
  console.log(`Campaigns to scan: ${campaigns.length}`);

  const hits: Array<{ campaign: CampaignRow; removed: FlowEdge[]; next: FlowData }> = [];

  for (const campaign of campaigns) {
    const { next, removed } = pruneOrphanEdges(campaign.flow_data);
    if (removed.length === 0 || !next) continue;
    hits.push({ campaign, removed, next });
  }

  console.log(`Campaigns with orphan edges: ${hits.length}`);
  let totalRemoved = 0;
  for (const hit of hits) {
    totalRemoved += hit.removed.length;
    console.log(
      `\nCampaign ${hit.campaign.id} (${hit.campaign.name ?? '<unknown>'}) status=${hit.campaign.status ?? '<missing>'} orphan_edges=${hit.removed.length}`,
    );
    for (const edge of hit.removed) {
      console.log(`  - ${edge.id ?? '<no-id>'}: ${edge.source ?? '?'} -> ${edge.target ?? '?'}`);
    }
  }
  console.log(`\nTotal orphan edges: ${totalRemoved}`);

  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to rewrite flow_data.edges.');
    return;
  }

  if (hits.length === 0) {
    console.log('Nothing to repair.');
    return;
  }

  let updated = 0;
  for (const hit of hits) {
    const { error } = await supabase
      .from('campaigns')
      .update({
        flow_data: hit.next,
        updated_at: new Date().toISOString(),
      })
      .eq('id', hit.campaign.id)
      .is('deleted_at', null);
    if (error) {
      console.error(`Failed to update ${hit.campaign.id}: ${error.message}`);
      process.exit(1);
    }
    updated += 1;
    console.log(`Updated campaign ${hit.campaign.id} (removed ${hit.removed.length} edges)`);
  }

  console.log(`Rewrote flow_data on ${updated} campaigns.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
