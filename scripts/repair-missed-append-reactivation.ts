/**
 * Reactivate completed enrollments stranded on older leaves after a later
 * flow append (Email 3 / Email 4) that product append-reactivation missed.
 *
 * Matches product append behavior:
 *   - state → active
 *   - next_run_at / updated_at → NOW()
 *   - current_node_id unchanged (do not skip waits)
 *
 * Scheduler then:
 *   - Email-leaf cohort: sees prior send → enters the next wait (full duration)
 *   - Wait-leaf cohort: advances to the next email (wait already current)
 *
 * Usage:
 *   CAMPAIGN_ID=<uuid> npx tsx scripts/repair-missed-append-reactivation.ts
 *   CAMPAIGN_ID=<uuid> FLOW_NODE_IDS=id1,id2 npx tsx scripts/repair-missed-append-reactivation.ts
 *   CAMPAIGN_ID=<uuid> APPLY=true npx tsx scripts/repair-missed-append-reactivation.ts
 *
 * Defaults FLOW_NODE_IDS for campaign 1c531fe8-… to Email 2 + wait-after-Email 2.
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

/** C Suite (5+ years): Email 2 + wait after Email 2 */
const DEFAULT_CAMPAIGN_ID = '1c531fe8-5832-4ba0-90be-dfae79cd904b';
const DEFAULT_FLOW_NODE_IDS_BY_CAMPAIGN: Record<string, string[]> = {
  [DEFAULT_CAMPAIGN_ID]: [
    '1781624141082-7ev6wlug6', // Email 2
    '1782171174278-qxwocoro6', // Wait after Email 2
  ],
};

const PAGE_SIZE = 1000;
const UPDATE_CHUNK = 200;

type NodeRow = {
  id: string;
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

function parseFlowNodeIds(campaignId: string): string[] {
  const fromEnv = process.env.FLOW_NODE_IDS?.trim();
  if (fromEnv) {
    return [...new Set(fromEnv.split(',').map((id) => id.trim()).filter(Boolean))];
  }
  const defaults = DEFAULT_FLOW_NODE_IDS_BY_CAMPAIGN[campaignId];
  if (defaults?.length) {
    return defaults;
  }
  throw new Error(
    'FLOW_NODE_IDS is required when CAMPAIGN_ID has no built-in defaults (comma-separated flow_node_id values).',
  );
}

async function fetchAllCompletedOnNodes(
  supabase: Awaited<ReturnType<typeof import('@supabase/supabase-js').createClient>>,
  campaignId: string,
  nodeIds: string[],
): Promise<EnrollmentRow[]> {
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
      throw new Error(`Failed to load enrollments: ${error.message}`);
    }

    const page = (data ?? []) as EnrollmentRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function main() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const campaignId = process.env.CAMPAIGN_ID?.trim() || DEFAULT_CAMPAIGN_ID;
  const apply = process.env.APPLY === 'true';
  const flowNodeIds = parseFlowNodeIds(campaignId);
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
  console.log(`Campaign id: ${campaignId}`);
  console.log(`Target flow_node_ids: ${flowNodeIds.join(', ')}`);

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, name, status, deleted_at')
    .eq('id', campaignId)
    .maybeSingle();

  if (campaignError) {
    console.error('Failed to load campaign:', campaignError.message);
    process.exit(1);
  }
  if (!campaign || campaign.deleted_at) {
    console.error('Campaign not found or soft-deleted.');
    process.exit(1);
  }

  console.log(`Campaign name: ${campaign.name ?? '<unknown>'}`);
  console.log(`Campaign status: ${campaign.status ?? '<missing>'}`);

  const { data: nodes, error: nodesError } = await supabase
    .from('nodes')
    .select('id, flow_node_id, node_type, node_data')
    .eq('campaign_id', campaignId)
    .in('flow_node_id', flowNodeIds)
    .is('deleted_at', null);

  if (nodesError) {
    console.error('Failed to load nodes:', nodesError.message);
    process.exit(1);
  }

  const nodeRows = (nodes ?? []) as NodeRow[];
  const missingFlowNodeIds = flowNodeIds.filter(
    (id) => !nodeRows.some((node) => node.flow_node_id === id),
  );
  if (missingFlowNodeIds.length > 0) {
    console.error(`Missing active nodes for flow_node_ids: ${missingFlowNodeIds.join(', ')}`);
    process.exit(1);
  }

  const nodeById = new Map(nodeRows.map((node) => [node.id, node]));
  const nodeIds = nodeRows.map((node) => node.id);

  console.log('Target nodes:');
  for (const node of nodeRows) {
    console.log(
      `- flow_node_id=${node.flow_node_id} type=${node.node_type} label=${node.node_data?.label ?? '<none>'} db_id=${node.id}`,
    );
  }

  let candidates: EnrollmentRow[];
  try {
    candidates = await fetchAllCompletedOnNodes(supabase, campaignId, nodeIds);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const byFlowNode = new Map<string, number>();
  for (const enrollment of candidates) {
    const node = enrollment.current_node_id
      ? nodeById.get(enrollment.current_node_id)
      : undefined;
    const key = node
      ? `${node.node_type}:${node.node_data?.label ?? node.flow_node_id}`
      : '<unknown>';
    byFlowNode.set(key, (byFlowNode.get(key) ?? 0) + 1);
  }

  console.log(`Repair candidates: ${candidates.length}`);
  console.log('Breakdown by parked node:');
  for (const [label, count] of [...byFlowNode.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`- ${label}: ${count}`);
  }

  if (candidates.length > 0) {
    console.log('Preview (first 25):');
    console.log(
      JSON.stringify(
        candidates.slice(0, 25).map((enrollment) => {
          const node = enrollment.current_node_id
            ? nodeById.get(enrollment.current_node_id)
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
    'Behavior on APPLY: set state=active, next_run_at=NOW(), updated_at=NOW(); leave current_node_id unchanged (waits are not skipped).',
  );

  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to reactivate candidates.');
    return;
  }

  if (candidates.length === 0) {
    console.log('Nothing to repair.');
    return;
  }

  const now = new Date().toISOString();
  let repaired = 0;

  for (let i = 0; i < candidates.length; i += UPDATE_CHUNK) {
    const chunkIds = candidates.slice(i, i + UPDATE_CHUNK).map((row) => row.id);
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
      console.error(`Failed to reactivate chunk starting at ${i}: ${updateError.message}`);
      process.exit(1);
    }

    repaired += updatedRows?.length ?? 0;
    console.log(`Updated chunk ${i / UPDATE_CHUNK + 1}: ${updatedRows?.length ?? 0} rows`);
  }

  console.log(
    `Reactivated ${repaired} completed enrollments. Scheduler will resume from parked nodes without skipping waits.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
