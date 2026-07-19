/**
 * Audit / repair completed enrollments stranded on non-leaf nodes after flow
 * appends (older leaves that tip-only reactivation missed).
 *
 * Matches product heal after 20260719120000_flow_edit_orphan_edge_integrity:
 *   - Candidate: state=completed on a non-categorizer node whose flow_node_id is
 *     the source of an edge whose target exists in flow_data.nodes
 *   - APPLY: state → active, next_run_at / updated_at → NOW()
 *   - current_node_id unchanged (do not skip waits)
 *   - stopped enrollments and aiCategorizer category-exits are never touched
 *
 * Usage:
 *   # Audit all non-deleted campaigns (dry run)
 *   npx tsx scripts/repair-missed-append-reactivation.ts
 *
 *   # Single campaign
 *   CAMPAIGN_ID=<uuid> npx tsx scripts/repair-missed-append-reactivation.ts
 *
 *   # Optional: restrict to explicit flow_node_ids (comma-separated)
 *   CAMPAIGN_ID=<uuid> FLOW_NODE_IDS=id1,id2 npx tsx scripts/repair-missed-append-reactivation.ts
 *
 *   # Apply repairs
 *   APPLY=true npx tsx scripts/repair-missed-append-reactivation.ts
 *   CAMPAIGN_ID=<uuid> APPLY=true npx tsx scripts/repair-missed-append-reactivation.ts
 *
 * Resolution order:
 *   1. Load repo `.env.local` / `.env` plus `infra/workers/.env.local` / `.env`
 *   2. Resolve Supabase URL from explicit env, then prod worker env, then dev env
 *   3. Prefer `SUPABASE_SECRET_KEY_PARAM_PATH` (or derive it from worker SSM prefixes)
 *   4. Fall back to `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`
 */

import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

const PAGE_SIZE = 1000;
const UPDATE_CHUNK = 200;
const CAMPAIGN_PAGE_SIZE = 200;

type CampaignRow = {
  id: string;
  name: string | null;
  status: string | null;
  flow_data: {
    nodes?: Array<{ id?: string }>;
    edges?: Array<{ source?: string; target?: string }>;
  } | null;
};

type NodeRow = {
  id: string;
  campaign_id: string;
  flow_node_id: string;
  node_type: string;
  node_data: { label?: string } | null;
};

type EnrollmentRow = {
  id: string;
  campaign_id: string;
  lead_id: string;
  current_node_id: string | null;
  state: string;
  next_run_at: string | null;
  updated_at: string;
};

type SupabaseClient = Awaited<ReturnType<typeof import('@supabase/supabase-js').createClient>>;

function parseOptionalFlowNodeIds(): string[] | null {
  const fromEnv = process.env.FLOW_NODE_IDS?.trim();
  if (!fromEnv) return null;
  return [...new Set(fromEnv.split(',').map((id) => id.trim()).filter(Boolean))];
}

function nonLeafFlowNodeIdsFromFlow(
  flowData: CampaignRow['flow_data'],
  restrictTo: string[] | null,
): Set<string> {
  const nodeIds = new Set(
    (flowData?.nodes ?? [])
      .map((node) => node.id?.trim())
      .filter((id): id is string => Boolean(id)),
  );
  const sources = new Set<string>();
  for (const edge of flowData?.edges ?? []) {
    const source = edge.source?.trim();
    const target = edge.target?.trim();
    if (!source || !target) continue;
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    sources.add(source);
  }
  if (!restrictTo) return sources;
  const allowed = new Set(restrictTo);
  return new Set([...sources].filter((id) => allowed.has(id)));
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
    if (error) {
      throw new Error(`Failed to load campaign: ${error.message}`);
    }
    if (!data || data.deleted_at) {
      throw new Error('Campaign not found or soft-deleted.');
    }
    return [
      {
        id: data.id as string,
        name: (data.name as string | null) ?? null,
        status: (data.status as string | null) ?? null,
        flow_data: (data.flow_data as CampaignRow['flow_data']) ?? null,
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

    if (error) {
      throw new Error(`Failed to load campaigns: ${error.message}`);
    }

    const page = (data ?? []) as CampaignRow[];
    rows.push(...page);
    if (page.length < CAMPAIGN_PAGE_SIZE) break;
  }
  return rows;
}

async function fetchNodesForCampaign(
  supabase: SupabaseClient,
  campaignId: string,
  flowNodeIds: string[],
): Promise<NodeRow[]> {
  if (flowNodeIds.length === 0) return [];

  const { data, error } = await supabase
    .from('nodes')
    .select('id, campaign_id, flow_node_id, node_type, node_data')
    .eq('campaign_id', campaignId)
    .in('flow_node_id', flowNodeIds)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to load nodes for ${campaignId}: ${error.message}`);
  }
  return (data ?? []) as NodeRow[];
}

async function fetchCompletedOnNodes(
  supabase: SupabaseClient,
  campaignId: string,
  nodeIds: string[],
): Promise<EnrollmentRow[]> {
  if (nodeIds.length === 0) return [];

  const rows: EnrollmentRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('enrollments')
      .select('id, campaign_id, lead_id, current_node_id, state, next_run_at, updated_at')
      .eq('campaign_id', campaignId)
      .eq('state', 'completed')
      .is('deleted_at', null)
      .in('current_node_id', nodeIds)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load enrollments for ${campaignId}: ${error.message}`);
    }

    const page = (data ?? []) as EnrollmentRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function reactivateEnrollments(
  supabase: SupabaseClient,
  campaignId: string,
  enrollmentIds: string[],
): Promise<number> {
  const now = new Date().toISOString();
  let repaired = 0;

  for (let i = 0; i < enrollmentIds.length; i += UPDATE_CHUNK) {
    const chunkIds = enrollmentIds.slice(i, i + UPDATE_CHUNK);
    const { data: updatedRows, error: updateError } = await supabase
      .from('enrollments')
      .update({
        state: 'active',
        next_run_at: now,
        updated_at: now,
      })
      .in('id', chunkIds)
      .eq('campaign_id', campaignId)
      .eq('state', 'completed')
      .is('deleted_at', null)
      .select('id');

    if (updateError) {
      throw new Error(
        `Failed to reactivate chunk for ${campaignId} starting at ${i}: ${updateError.message}`,
      );
    }

    repaired += updatedRows?.length ?? 0;
  }

  return repaired;
}

async function main() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const campaignIdFilter = process.env.CAMPAIGN_ID?.trim() || null;
  const apply = process.env.APPLY === 'true';
  const restrictFlowNodeIds = parseOptionalFlowNodeIds();
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
      if (!key) {
        throw error;
      }
      console.warn(
        `[repair-missed-append-reactivation] Failed to fetch ${secretParamPath}; falling back to existing secret env.`,
      );
    }
  }

  if (!url || !key) {
    console.error(
      'Missing Supabase configuration. Provide a resolvable URL plus either SSM worker secret prefixes / SUPABASE_SECRET_KEY_PARAM_PATH, or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY.',
    );
    process.exit(1);
  }

  console.log(`Target env: ${targetEnv}`);
  console.log(`Resolved SUPABASE_URL from ${urlSource}.`);
  if (secretParamPath) {
    console.log(`Resolved SUPABASE secret from Parameter Store path ${secretParamPath}.`);
  } else {
    console.log('Resolved SUPABASE secret from environment variable.');
  }
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(
    campaignIdFilter
      ? `Campaign filter: ${campaignIdFilter}`
      : 'Campaign filter: all non-deleted campaigns',
  );
  if (restrictFlowNodeIds) {
    console.log(`FLOW_NODE_IDS restrict: ${restrictFlowNodeIds.join(', ')}`);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  let campaigns: CampaignRow[];
  try {
    campaigns = await fetchCampaigns(supabase, campaignIdFilter);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.log(`Campaigns to scan: ${campaigns.length}`);

  type CampaignHit = {
    campaign: CampaignRow;
    candidates: EnrollmentRow[];
    nodeById: Map<string, NodeRow>;
  };

  const hits: CampaignHit[] = [];
  let totalCandidates = 0;

  for (const campaign of campaigns) {
    const nonLeafIds = nonLeafFlowNodeIdsFromFlow(campaign.flow_data, restrictFlowNodeIds);
    if (nonLeafIds.size === 0) continue;

    let nodeRows: NodeRow[];
    try {
      nodeRows = await fetchNodesForCampaign(supabase, campaign.id, [...nonLeafIds]);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    // Category-exit completions on aiCategorizer are intentional — never reactivate.
    nodeRows = nodeRows.filter((node) => node.node_type !== 'aiCategorizer');
    if (nodeRows.length === 0) continue;

    const nodeById = new Map(nodeRows.map((node) => [node.id, node]));
    const nodeIds = nodeRows.map((node) => node.id);

    let candidates: EnrollmentRow[];
    try {
      candidates = await fetchCompletedOnNodes(supabase, campaign.id, nodeIds);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    if (candidates.length === 0) continue;

    hits.push({ campaign, candidates, nodeById });
    totalCandidates += candidates.length;
  }

  console.log(`Campaigns with stranded completed: ${hits.length}`);
  console.log(`Total repair candidates: ${totalCandidates}`);

  for (const hit of hits) {
    const byParked = new Map<string, number>();
    for (const enrollment of hit.candidates) {
      const node = enrollment.current_node_id
        ? hit.nodeById.get(enrollment.current_node_id)
        : undefined;
      const key = node
        ? `${node.node_type}:${node.node_data?.label ?? node.flow_node_id}`
        : '<unknown>';
      byParked.set(key, (byParked.get(key) ?? 0) + 1);
    }

    console.log(
      `\nCampaign ${hit.campaign.id} (${hit.campaign.name ?? '<unknown>'}) status=${hit.campaign.status ?? '<missing>'} candidates=${hit.candidates.length}`,
    );
    for (const [label, count] of [...byParked.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  - ${label}: ${count}`);
    }

    console.log('  Preview (first 10):');
    console.log(
      JSON.stringify(
        hit.candidates.slice(0, 10).map((enrollment) => {
          const node = enrollment.current_node_id
            ? hit.nodeById.get(enrollment.current_node_id)
            : undefined;
          return {
            enrollment_id: enrollment.id,
            lead_id: enrollment.lead_id,
            parked_flow_node_id: node?.flow_node_id ?? null,
            parked_type: node?.node_type ?? null,
            parked_label: node?.node_data?.label ?? null,
            next_run_at: enrollment.next_run_at,
            updated_at: enrollment.updated_at,
          };
        }),
        null,
        2,
      ),
    );
  }

  console.log(
    '\nBehavior on APPLY: set state=active, next_run_at=NOW(), updated_at=NOW(); leave current_node_id unchanged (waits are not skipped).',
  );

  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to reactivate candidates.');
    return;
  }

  if (totalCandidates === 0) {
    console.log('Nothing to repair.');
    return;
  }

  let repairedTotal = 0;
  for (const hit of hits) {
    const repaired = await reactivateEnrollments(
      supabase,
      hit.campaign.id,
      hit.candidates.map((row) => row.id),
    );
    repairedTotal += repaired;
    console.log(`Reactivated ${repaired} on campaign ${hit.campaign.id}`);
  }

  console.log(
    `Reactivated ${repairedTotal} completed enrollments across ${hits.length} campaigns. Scheduler will resume from parked nodes without skipping waits.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
