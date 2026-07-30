/**
 * Backfill waitTime node durations in campaigns.flow_data:
 * - empty / missing / <= 0 → 3 days (259200s)
 * - positive but under 3 minutes → 180s
 *
 * Writing flow_data fires sync_campaign_nodes, which resyncs nodes.node_data.
 * Runtime scheduler already applies the same floor, but this rewrites stored
 * flow JSON so builder UI and API reads match.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/repair-wait-durations.ts
 *   CAMPAIGN_ID=<uuid> npx tsx scripts/repair-wait-durations.ts
 *   APPLY=true SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/repair-wait-durations.ts
 */

import {
  DEFAULT_WAIT_DURATION_SECONDS,
  MIN_WAIT_DURATION_SECONDS,
  inferDurationUnit,
  inferDurationValue,
  resolveWaitDurationSeconds,
} from '../lib/campaigns/flow/waitTime.js';
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
  data?: Record<string, unknown> | null;
  [key: string]: unknown;
};
type FlowEdge = { [key: string]: unknown };
type FlowData = { nodes?: FlowNode[]; edges?: FlowEdge[]; [key: string]: unknown };

type CampaignRow = {
  id: string;
  name: string | null;
  status: string | null;
  flow_data: FlowData | null;
};

type WaitChange = {
  nodeId: string;
  label: string;
  fromSeconds: number | null;
  toSeconds: number;
  reason: 'default_empty' | 'clamp_min' | 'fill_missing_seconds';
};

type SupabaseClient = Awaited<ReturnType<typeof import('@supabase/supabase-js').createClient>>;

function currentStoredSeconds(data: Record<string, unknown>): number | null {
  if (typeof data.wait_duration_seconds === 'number' && Number.isFinite(data.wait_duration_seconds)) {
    return Math.floor(data.wait_duration_seconds);
  }
  return null;
}

function changeReason(
  fromSeconds: number | null,
  toSeconds: number,
): WaitChange['reason'] {
  if (fromSeconds === null) return 'fill_missing_seconds';
  if (fromSeconds <= 0) return 'default_empty';
  if (fromSeconds < MIN_WAIT_DURATION_SECONDS) return 'clamp_min';
  if (toSeconds === DEFAULT_WAIT_DURATION_SECONDS && fromSeconds !== toSeconds) {
    return 'default_empty';
  }
  return 'fill_missing_seconds';
}

function healWaitDurations(flowData: FlowData | null): {
  next: FlowData | null;
  changes: WaitChange[];
} {
  if (!flowData || !Array.isArray(flowData.nodes)) {
    return { next: flowData, changes: [] };
  }

  const changes: WaitChange[] = [];
  const nextNodes = flowData.nodes.map((node) => {
    if (node.type !== 'waitTime' || typeof node.id !== 'string') return node;

    const data = (node.data && typeof node.data === 'object' ? node.data : {}) as Record<
      string,
      unknown
    >;
    const fromSeconds = currentStoredSeconds(data);
    const toSeconds = resolveWaitDurationSeconds({
      wait_duration_seconds: data.wait_duration_seconds,
      duration: data.duration,
      unit: data.unit,
    });

    const needsRewrite =
      fromSeconds === null
      || fromSeconds <= 0
      || fromSeconds < MIN_WAIT_DURATION_SECONDS
      || fromSeconds !== toSeconds;

    if (!needsRewrite) return node;

    const unit = inferDurationUnit(toSeconds);
    const duration = inferDurationValue(toSeconds, unit);
    changes.push({
      nodeId: node.id,
      label: typeof data.label === 'string' && data.label.trim() ? data.label : '<no label>',
      fromSeconds,
      toSeconds,
      reason: changeReason(fromSeconds, toSeconds),
    });

    return {
      ...node,
      data: {
        ...data,
        duration,
        unit,
        wait_duration_seconds: toSeconds,
      },
    };
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
        `[repair-wait-durations] Failed to fetch ${secretParamPath}; falling back to existing secret env.`,
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
  console.log(
    `Rules: empty/missing/<=0 → ${DEFAULT_WAIT_DURATION_SECONDS}s (3 days);`
    + ` under ${MIN_WAIT_DURATION_SECONDS}s → clamp to ${MIN_WAIT_DURATION_SECONDS}s (3 minutes)`,
  );

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const campaigns = await fetchCampaigns(supabase, campaignIdFilter);
  console.log(`Campaigns to scan: ${campaigns.length}`);

  const hits: Array<{ campaign: CampaignRow; changes: WaitChange[]; next: FlowData }> = [];

  for (const campaign of campaigns) {
    const { next, changes } = healWaitDurations(campaign.flow_data);
    if (changes.length === 0 || !next) continue;
    hits.push({ campaign, changes, next });
  }

  console.log(`Campaigns needing wait heal: ${hits.length}`);
  let totalChanges = 0;
  for (const hit of hits) {
    totalChanges += hit.changes.length;
    console.log(
      `\nCampaign ${hit.campaign.id} (${hit.campaign.name ?? '<unknown>'})`
      + ` status=${hit.campaign.status ?? '<missing>'} changes=${hit.changes.length}`,
    );
    for (const change of hit.changes) {
      console.log(
        `  - ${change.nodeId} (${change.label}):`
        + ` ${String(change.fromSeconds)} -> ${change.toSeconds}`
        + ` [${change.reason}]`,
      );
    }
  }
  console.log(`\nTotal wait node changes: ${totalChanges}`);

  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to rewrite flow_data wait durations.');
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
    console.log(`Updated campaign ${hit.campaign.id} (${hit.changes.length} wait changes)`);
  }

  console.log(`Rewrote flow_data on ${updated} campaigns.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
