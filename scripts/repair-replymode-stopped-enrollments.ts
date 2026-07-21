/**
 * Reactivate enrollments that were incorrectly stopped by the pre-fix reply-mode
 * guard ("Reply-mode email node reached without an upstream categorizer branch").
 *
 * These enrollments hit a main-path email node that had been misconfigured as
 * send_mode='reply'. The repair-email-send-mode script re-derived node priority
 * positionally (the node is now a normal paced email), which fixes the CAUSE.
 * This script fixes the SYMPTOM: it un-stops the affected enrollments so the
 * scheduler resumes them from their frozen current_node_id (typically the wait
 * node immediately before the previously-broken email).
 *
 * Scope is intentionally narrow and conservative:
 *   - state = 'stopped'
 *   - stopped_reason = 'error'            (never-replied bug victims only)
 *   - stopped_error_message LIKE 'Reply-mode email node reached%'
 *   - NOT reactivated if a live (queued/reserved/sending) campaign job still
 *     exists for the enrollment (avoids any double-send).
 *
 * It deliberately does NOT touch stopped_reason='replied' (lead already engaged;
 * continuing the cold path is wrong) or 'bounced' (bad address).
 *
 * Usage:
 *   CAMPAIGN_ID=<uuid> npx tsx scripts/repair-replymode-stopped-enrollments.ts
 *   CAMPAIGN_ID=<uuid> APPLY=true npx tsx scripts/repair-replymode-stopped-enrollments.ts
 *   SELF_RECOVERY_TARGET_ENV=prod CAMPAIGN_ID=<uuid> npx tsx scripts/repair-replymode-stopped-enrollments.ts
 */

import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

const REPLY_MODE_MESSAGE_PREFIX = 'Reply-mode email node reached';
/** PostgREST caps `.in()` list sizes on the request URL; chunk id lookups. */
const IN_CLAUSE_CHUNK_SIZE = 100;

type EnrollmentRow = {
  id: string;
  campaign_id: string;
  lead_id: string;
  current_node_id: string | null;
  state: 'active' | 'paused' | 'stopped' | 'completed';
  stopped_at: string | null;
  stopped_reason: string | null;
  stopped_error_message: string | null;
  next_run_at: string | null;
  deleted_at: string | null;
};

type MessageJobRow = {
  id: string;
  enrollment_id: string;
  status: string;
  message_type: string | null;
};

type SupabaseClient = Awaited<ReturnType<typeof import('@supabase/supabase-js').createClient>>;

function isLiveCampaignJob(job: MessageJobRow): boolean {
  const isCampaign = job.message_type === 'campaign' || job.message_type === null;
  return isCampaign && ['queued', 'reserved', 'sending'].includes(job.status);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function loadReplyModeStoppedEnrollments(
  supabase: SupabaseClient,
  campaignId: string | null,
): Promise<EnrollmentRow[]> {
  const rows: EnrollmentRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from('enrollments')
      .select(
        'id, campaign_id, lead_id, current_node_id, state, stopped_at, stopped_reason, stopped_error_message, next_run_at, deleted_at',
      )
      .eq('state', 'stopped')
      .eq('stopped_reason', 'error')
      .is('deleted_at', null)
      .like('stopped_error_message', `${REPLY_MODE_MESSAGE_PREFIX}%`)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load reply-mode stopped enrollments: ${error.message}`);
    }
    const page = (data ?? []) as EnrollmentRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function loadLiveJobEnrollmentIds(
  supabase: SupabaseClient,
  enrollmentIds: string[],
): Promise<Set<string>> {
  const live = new Set<string>();
  for (const slice of chunk(enrollmentIds, IN_CLAUSE_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('message_jobs')
      .select('id, enrollment_id, status, message_type')
      .in('enrollment_id', slice);
    if (error) {
      throw new Error(`Failed to load related message jobs: ${error.message}`);
    }
    for (const job of (data ?? []) as MessageJobRow[]) {
      if (isLiveCampaignJob(job)) {
        live.add(job.enrollment_id);
      }
    }
  }
  return live;
}

async function main() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const campaignId = process.env.CAMPAIGN_ID?.trim() || null;
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
        `[repair-replymode-stopped-enrollments] Failed to fetch ${secretParamPath}; falling back to existing secret env.`,
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
  console.log(campaignId ? `Campaign filter: ${campaignId}` : 'Campaign filter: ALL campaigns');

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const stopped = await loadReplyModeStoppedEnrollments(supabase, campaignId);
  console.log(`Reply-mode error-stopped enrollments: ${stopped.length}`);

  if (stopped.length === 0) {
    console.log('Nothing to repair.');
    return;
  }

  const liveJobEnrollmentIds = await loadLiveJobEnrollmentIds(
    supabase,
    stopped.map((e) => e.id),
  );

  const candidates = stopped.filter((e) => !liveJobEnrollmentIds.has(e.id));
  const skipped = stopped.filter((e) => liveJobEnrollmentIds.has(e.id));

  console.log(`Skipped (live campaign job still exists): ${skipped.length}`);
  console.log(`Reactivation candidates: ${candidates.length}`);

  const byCampaign = new Map<string, number>();
  for (const e of candidates) {
    byCampaign.set(e.campaign_id, (byCampaign.get(e.campaign_id) ?? 0) + 1);
  }
  console.log('Per-campaign candidates:');
  for (const [id, count] of [...byCampaign.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`- campaign_id=${id} candidates=${count}`);
  }

  const byCurrentNode = new Map<string, number>();
  for (const e of candidates) {
    const nodeKey = e.current_node_id ?? '<null>';
    byCurrentNode.set(nodeKey, (byCurrentNode.get(nodeKey) ?? 0) + 1);
  }
  console.log('Candidates by frozen current_node_id:');
  for (const [nodeId, count] of [...byCurrentNode.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`- current_node_id=${nodeId} count=${count}`);
  }

  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to reactivate candidates.');
    return;
  }

  const now = new Date().toISOString();
  let reactivated = 0;
  for (const slice of chunk(candidates.map((e) => e.id), 500)) {
    const { data, error } = await supabase
      .from('enrollments')
      .update({
        state: 'active',
        stopped_reason: null,
        stopped_at: null,
        stopped_error_message: null,
        next_run_at: now,
        updated_at: now,
      } as never)
      .in('id', slice)
      .eq('state', 'stopped')
      .eq('stopped_reason', 'error')
      .like('stopped_error_message', `${REPLY_MODE_MESSAGE_PREFIX}%`)
      .select('id');
    if (error) {
      console.error(`Failed to reactivate batch: ${error.message}`);
      process.exit(1);
    }
    reactivated += data?.length ?? 0;
    console.log(`Reactivated ${reactivated}/${candidates.length}...`);
  }

  console.log(`Reactivated ${reactivated} enrollments (next_run_at=${now}).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
