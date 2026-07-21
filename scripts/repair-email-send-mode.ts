/**
 * Heal campaigns.flow_data email priority to match the positional derivation
 * rule (lib/campaigns/flow/graphIntegrity deriveEmailPriority): any email
 * downstream of a categorizer is priority; all others are not.
 *
 * The repair also strips legacy `send_mode` from flow_data email nodes. The
 * rest of flow_data is left byte-identical. Writing flow_data fires the
 * sync_campaign_nodes trigger, which resyncs nodes.node_data for runtime
 * readers.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/repair-email-send-mode.ts
 *   CAMPAIGN_ID=<uuid> npx tsx scripts/repair-email-send-mode.ts
 *   APPLY=true SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/repair-email-send-mode.ts
 */

import {
  deriveEmailPriority,
  nodeIdsDownstreamOfCategorizer,
} from '../lib/campaigns/flow/graphIntegrity.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

const CAMPAIGN_PAGE_SIZE = 200;

type FlowNode = {
  id?: string;
  type?: string;
  data?: { priority?: boolean; send_mode?: string } | null;
  [key: string]: unknown;
};
type FlowEdge = { source?: string; target?: string; [key: string]: unknown };
type FlowData = { nodes?: FlowNode[]; edges?: FlowEdge[]; [key: string]: unknown };

type CampaignRow = {
  id: string;
  name: string | null;
  status: string | null;
  flow_data: FlowData | null;
};

type PriorityChange = {
  nodeId: string;
  label: string;
  from: boolean | null;
  to: boolean;
  removedLegacySendMode: boolean;
};

type SupabaseClient = Awaited<ReturnType<typeof import('@supabase/supabase-js').createClient>>;

function healPriorities(flowData: FlowData | null): {
  next: FlowData | null;
  changes: PriorityChange[];
} {
  if (!flowData || !Array.isArray(flowData.nodes)) {
    return { next: flowData, changes: [] };
  }
  const nodes = flowData.nodes;
  const edges = Array.isArray(flowData.edges) ? flowData.edges : [];
  const downstream = nodeIdsDownstreamOfCategorizer(nodes, edges);

  const changes: PriorityChange[] = [];
  const nextNodes = nodes.map((node) => {
    if (node.type !== 'email' || typeof node.id !== 'string') return node;
    const desired = deriveEmailPriority(node, downstream);
    const data = node.data ?? {};
    const current = typeof data.priority === 'boolean' ? data.priority : null;
    const removedLegacySendMode = Object.prototype.hasOwnProperty.call(data, 'send_mode');
    if (current === desired && !removedLegacySendMode) return node;
    changes.push({
      nodeId: node.id,
      label: typeof (node.data as { label?: string } | null)?.label === 'string'
        ? (node.data as { label?: string }).label!
        : '<no label>',
      from: current,
      to: desired,
      removedLegacySendMode,
    });
    const { send_mode: _legacySendMode, ...rest } = data;
    return { ...node, data: { ...rest, priority: desired } };
  });

  if (changes.length === 0) {
    return { next: flowData, changes };
  }
  return { next: { ...flowData, nodes: nextNodes }, changes };
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
        `[repair-email-send-mode] Failed to fetch ${secretParamPath}; falling back to existing secret env.`,
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

  const hits: Array<{ campaign: CampaignRow; changes: PriorityChange[]; next: FlowData }> = [];

  for (const campaign of campaigns) {
    const { next, changes } = healPriorities(campaign.flow_data);
    if (changes.length === 0 || !next) continue;
    hits.push({ campaign, changes, next });
  }

  console.log(`Campaigns needing priority heal: ${hits.length}`);
  let totalChanges = 0;
  for (const hit of hits) {
    totalChanges += hit.changes.length;
    console.log(
      `\nCampaign ${hit.campaign.id} (${hit.campaign.name ?? '<unknown>'}) status=${hit.campaign.status ?? '<missing>'} changes=${hit.changes.length}`,
    );
    for (const change of hit.changes) {
      console.log(
        `  - ${change.nodeId} (${change.label}): priority ${String(change.from)} -> ${String(change.to)}`
        + (change.removedLegacySendMode ? ' (removed legacy send_mode)' : ''),
      );
    }
  }
  console.log(`\nTotal priority changes: ${totalChanges}`);

  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to rewrite flow_data email priority.');
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
    console.log(`Updated campaign ${hit.campaign.id} (${hit.changes.length} priority changes)`);
  }

  console.log(`Rewrote flow_data on ${updated} campaigns.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
