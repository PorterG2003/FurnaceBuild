/**
 * Reactivate Interested enrollments that were hard-stopped on reply without ever
 * branching through the categorizer → Link path (July Training recovery).
 *
 * Places eligible enrollments on the live categorizer with next_run_at prioritized
 * and reply_thread_id pinned to the Interested thread so the scheduler branches
 * Interested → Link and sends on the priority lane.
 *
 * Default cohort: open conversations only. Use INCLUDE_CLOSED=true to also
 * re-touch closed threads.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod CAMPAIGN_ID=7548f6de-f2a1-4e30-b005-f3dc71186829 \
 *     npx tsx scripts/repair-july-training-missing-link.ts
 *
 *   SELF_RECOVERY_TARGET_ENV=prod CAMPAIGN_ID=... APPLY=true \
 *     npx tsx scripts/repair-july-training-missing-link.ts
 *
 *   SELF_RECOVERY_TARGET_ENV=prod CAMPAIGN_ID=... APPLY=true LIMIT=50 \
 *     npx tsx scripts/repair-july-training-missing-link.ts
 *
 *   SELF_RECOVERY_TARGET_ENV=prod CAMPAIGN_ID=... INCLUDE_CLOSED=true APPLY=true \
 *     npx tsx scripts/repair-july-training-missing-link.ts
 */

import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

const LINK_FLOW_NODE_ID = '1783355366467-mnslwswrn';
const IN_CLAUSE_CHUNK_SIZE = 100;
const APPLY_CHUNK_SIZE = 50;

type SupabaseClient = Awaited<ReturnType<typeof import('@supabase/supabase-js').createClient>>;

type ThreadRow = {
  id: string;
  enrollment_id: string;
  lead_id: string;
  conversation_status: string | null;
  last_inbound_at: string | null;
  category_source: string | null;
};

type EnrollmentRow = {
  id: string;
  campaign_id: string;
  lead_id: string;
  current_node_id: string | null;
  state: string;
  stopped_reason: string | null;
  stopped_at: string | null;
  reply_thread_id: string | null;
  current_flow_version_number: number | null;
  next_run_at: string | null;
};

type Candidate = {
  enrollment: EnrollmentRow;
  thread: ThreadRow;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function parseLimit(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`LIMIT must be a positive number (got ${raw})`);
  }
  return Math.floor(n);
}

async function loadInterestedThreads(
  supabase: SupabaseClient,
  campaignId: string,
  includeClosed: boolean,
): Promise<ThreadRow[]> {
  const rows: ThreadRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from('email_threads')
      .select('id, enrollment_id, lead_id, conversation_status, last_inbound_at, category_source')
      .eq('campaign_id', campaignId)
      .eq('has_reply', true)
      .eq('category', 'Interested')
      .not('enrollment_id', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (!includeClosed) {
      query = query.eq('conversation_status', 'open');
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load Interested threads: ${error.message}`);
    }
    const page = (data ?? []) as ThreadRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function loadEnrollmentsByIds(
  supabase: SupabaseClient,
  enrollmentIds: string[],
): Promise<Map<string, EnrollmentRow>> {
  const map = new Map<string, EnrollmentRow>();
  for (const slice of chunk(enrollmentIds, IN_CLAUSE_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('enrollments')
      .select(
        'id, campaign_id, lead_id, current_node_id, state, stopped_reason, stopped_at, reply_thread_id, current_flow_version_number, next_run_at',
      )
      .in('id', slice)
      .is('deleted_at', null);
    if (error) {
      throw new Error(`Failed to load enrollments: ${error.message}`);
    }
    for (const row of (data ?? []) as EnrollmentRow[]) {
      map.set(row.id, row);
    }
  }
  return map;
}

async function loadEnrollmentIdsWithLinkSent(
  supabase: SupabaseClient,
  campaignId: string,
  linkNodeId: string,
  enrollmentIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const slice of chunk(enrollmentIds, IN_CLAUSE_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('message_jobs')
      .select('enrollment_id')
      .eq('campaign_id', campaignId)
      .eq('node_id', linkNodeId)
      .eq('status', 'sent')
      .in('enrollment_id', slice);
    if (error) {
      throw new Error(`Failed to load Link sent jobs: ${error.message}`);
    }
    for (const row of data ?? []) {
      if (row.enrollment_id) out.add(row.enrollment_id as string);
    }
  }
  return out;
}

async function cancelColdPathJobs(
  supabase: SupabaseClient,
  enrollmentIds: string[],
  now: string,
): Promise<number> {
  let cancelled = 0;
  for (const slice of chunk(enrollmentIds, IN_CLAUSE_CHUNK_SIZE)) {
    const { data: jobs, error: loadError } = await supabase
      .from('message_jobs')
      .select('id, message_type, status')
      .in('enrollment_id', slice)
      .in('status', ['queued', 'deferred', 'held']);
    if (loadError) {
      throw new Error(`Failed to load cold-path jobs: ${loadError.message}`);
    }

    const cancelIds = ((jobs ?? []) as Array<{ id: string; message_type: string | null }>)
      .filter((job) => job.message_type !== 'inbox_reply' && job.message_type !== 'inbox_forward')
      .map((job) => job.id);

    if (cancelIds.length === 0) continue;

    for (const idSlice of chunk(cancelIds, IN_CLAUSE_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('message_jobs')
        .update({
          status: 'cancelled',
          status_reason: 'manually_cancelled',
          error_message: 'Cancelled by repair-july-training-missing-link (route to categorizer/Link)',
          updated_at: now,
        } as never)
        .in('id', idSlice)
        .in('status', ['queued', 'deferred', 'held'])
        .select('id');
      if (error) {
        throw new Error(`Failed to cancel cold-path jobs: ${error.message}`);
      }
      cancelled += data?.length ?? 0;
    }
  }
  return cancelled;
}

async function reactivateOntoCategorizer(
  supabase: SupabaseClient,
  candidates: Candidate[],
  categorizerNodeId: string,
  flowVersion: number,
  now: string,
  /**
   * Claim is global ORDER BY next_run_at ASC. Stamp slightly in the past so
   * repaired categorizer work is not starved behind thousands of due email nodes.
   */
  claimAt: string,
): Promise<number> {
  let updated = 0;
  for (const slice of chunk(candidates, APPLY_CHUNK_SIZE)) {
    for (const candidate of slice) {
      const { data, error } = await supabase
        .from('enrollments')
        .update({
          state: 'active',
          stopped_reason: null,
          stopped_at: null,
          stopped_error_message: null,
          current_node_id: categorizerNodeId,
          current_flow_version_number: flowVersion,
          // Pin the Interested thread so a newer uncategorized reply cannot park us.
          reply_thread_id: candidate.thread.id,
          held_node_id: null,
          held_next_run_at: null,
          next_run_at: claimAt,
          updated_at: now,
        } as never)
        .eq('id', candidate.enrollment.id)
        .eq('state', 'stopped')
        .eq('stopped_reason', 'replied')
        .is('reply_thread_id', null)
        .is('deleted_at', null)
        .select('id');
      if (error) {
        throw new Error(`Failed to reactivate enrollment ${candidate.enrollment.id}: ${error.message}`);
      }
      if ((data?.length ?? 0) > 0) updated += 1;
    }
    console.log(`Reactivated ${updated} enrollments...`);
  }
  return updated;
}

/**
 * Re-stamp already-reactivated cohort members that are still sitting on the
 * categorizer or Link node so the Interested thread is pinned and claim is prioritized.
 */
async function prioritizeExistingCohort(
  supabase: SupabaseClient,
  candidates: Candidate[],
  allowedNodeIds: string[],
  flowVersion: number,
  now: string,
  claimAt: string,
): Promise<number> {
  let updated = 0;
  for (const slice of chunk(candidates, APPLY_CHUNK_SIZE)) {
    for (const candidate of slice) {
      const { data, error } = await supabase
        .from('enrollments')
        .update({
          state: 'active',
          // Keep current_node_id (categorizer or Link); only pin thread + bump claim.
          current_flow_version_number: flowVersion,
          reply_thread_id: candidate.thread.id,
          held_node_id: null,
          held_next_run_at: null,
          next_run_at: claimAt,
          updated_at: now,
        } as never)
        .eq('id', candidate.enrollment.id)
        .eq('state', 'active')
        .in('current_node_id', allowedNodeIds)
        .is('deleted_at', null)
        .select('id');
      if (error) {
        throw new Error(`Failed to prioritize enrollment ${candidate.enrollment.id}: ${error.message}`);
      }
      if ((data?.length ?? 0) > 0) updated += 1;
    }
  }
  return updated;
}

async function main() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const campaignId = process.env.CAMPAIGN_ID?.trim();
  const apply = process.env.APPLY === 'true';
  const includeClosed = process.env.INCLUDE_CLOSED === 'true';
  const limit = parseLimit(process.env.LIMIT);
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  if (!campaignId) {
    console.error('CAMPAIGN_ID is required.');
    process.exit(1);
  }

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
        `[repair-july-training-missing-link] Failed to fetch ${secretParamPath}; falling back to existing secret env.`,
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
  console.log(`Campaign: ${campaignId}`);
  console.log(`Include closed: ${includeClosed}`);
  console.log(`Limit: ${limit ?? 'none'}`);

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, name, status, current_flow_version_number')
    .eq('id', campaignId)
    .is('deleted_at', null)
    .maybeSingle();

  if (campaignError) {
    throw new Error(`Failed to load campaign: ${campaignError.message}`);
  }
  if (!campaign) {
    console.error(`Campaign not found: ${campaignId}`);
    process.exit(1);
  }

  const flowVersion = Number(campaign.current_flow_version_number);
  if (!Number.isFinite(flowVersion) || flowVersion <= 0) {
    throw new Error(`Campaign has invalid current_flow_version_number: ${campaign.current_flow_version_number}`);
  }

  console.log(
    `Campaign name=${campaign.name} status=${campaign.status} flow_version=${flowVersion}`,
  );

  const { data: nodes, error: nodesError } = await supabase
    .from('nodes')
    .select('id, flow_node_id, node_type, node_data')
    .eq('campaign_id', campaignId)
    .is('deleted_at', null);

  if (nodesError) {
    throw new Error(`Failed to load nodes: ${nodesError.message}`);
  }

  const categorizer = (nodes ?? []).find((n) => n.node_type === 'aiCategorizer');
  const link = (nodes ?? []).find((n) => n.flow_node_id === LINK_FLOW_NODE_ID);

  if (!categorizer?.id) {
    throw new Error('Campaign has no live aiCategorizer node.');
  }
  if (!link?.id) {
    throw new Error(`Campaign has no live Link node (${LINK_FLOW_NODE_ID}).`);
  }

  console.log(`Categorizer node: ${categorizer.id}`);
  console.log(`Link node: ${link.id} label=${(link.node_data as { label?: string } | null)?.label ?? '?'}`);

  const threads = await loadInterestedThreads(supabase, campaignId, includeClosed);
  console.log(`Interested threads (${includeClosed ? 'open+closed' : 'open only'}): ${threads.length}`);

  const enrollmentIds = [...new Set(threads.map((t) => t.enrollment_id).filter(Boolean))];
  const enrollments = await loadEnrollmentsByIds(supabase, enrollmentIds);
  const linkSent = await loadEnrollmentIdsWithLinkSent(
    supabase,
    campaignId,
    link.id as string,
    enrollmentIds,
  );

  // Prefer the latest Interested thread per enrollment for reply_thread_id pinning.
  const bestInterestedThread = new Map<string, ThreadRow>();
  for (const thread of threads) {
    const prev = bestInterestedThread.get(thread.enrollment_id);
    if (!prev) {
      bestInterestedThread.set(thread.enrollment_id, thread);
      continue;
    }
    const prevAt = prev.last_inbound_at ? Date.parse(prev.last_inbound_at) : 0;
    const nextAt = thread.last_inbound_at ? Date.parse(thread.last_inbound_at) : 0;
    if (nextAt >= prevAt) bestInterestedThread.set(thread.enrollment_id, thread);
  }

  const skipReasons = {
    missing_enrollment: 0,
    already_link_sent: 0,
    not_eligible: 0,
  };

  const reactivateCandidates: Candidate[] = [];
  const prioritizeCandidates: Candidate[] = [];

  for (const [enrollmentId, thread] of bestInterestedThread) {
    const enrollment = enrollments.get(enrollmentId);
    if (!enrollment) {
      skipReasons.missing_enrollment += 1;
      continue;
    }
    if (linkSent.has(enrollment.id)) {
      skipReasons.already_link_sent += 1;
      continue;
    }

    const atCategorizer = enrollment.current_node_id === (categorizer.id as string);
    const atLink = enrollment.current_node_id === (link.id as string);
    const stoppedReplied =
      enrollment.state === 'stopped' && enrollment.stopped_reason === 'replied' && !enrollment.reply_thread_id;
    const needsPrioritize =
      enrollment.state === 'active' && (atCategorizer || atLink);

    if (stoppedReplied) {
      reactivateCandidates.push({ enrollment, thread });
      continue;
    }
    if (needsPrioritize) {
      prioritizeCandidates.push({ enrollment, thread });
      continue;
    }

    skipReasons.not_eligible += 1;
  }

  const reactivateLimited =
    limit != null ? reactivateCandidates.slice(0, limit) : reactivateCandidates;
  const remainingLimit =
    limit != null ? Math.max(limit - reactivateLimited.length, 0) : null;
  const prioritizeLimited =
    remainingLimit == null
      ? prioritizeCandidates
      : prioritizeCandidates.slice(0, remainingLimit);

  console.log('Skip reasons:');
  for (const [reason, count] of Object.entries(skipReasons)) {
    console.log(`- ${reason}: ${count}`);
  }
  console.log(`Reactivate candidates (stopped+replied): ${reactivateCandidates.length}`);
  console.log(`Prioritize candidates (active@categorizer|Link): ${prioritizeCandidates.length}`);
  console.log(
    `Will process this run: reactivate=${reactivateLimited.length} prioritize=${prioritizeLimited.length}`,
  );

  const sample = [...reactivateLimited, ...prioritizeLimited].slice(0, 10);
  if (sample.length > 0) {
    console.log('Sample (up to 10):');
    for (const c of sample) {
      console.log(
        `- enrollment=${c.enrollment.id} thread=${c.thread.id} lead=${c.enrollment.lead_id} ` +
          `state=${c.enrollment.state} version=${c.enrollment.current_flow_version_number} ` +
          `status=${c.thread.conversation_status} last_inbound=${c.thread.last_inbound_at ?? 'null'}`,
      );
    }
  }

  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to reactivate/prioritize onto categorizer.');
    return;
  }

  if (reactivateLimited.length === 0 && prioritizeLimited.length === 0) {
    console.log('Nothing to apply.');
    return;
  }

  const now = new Date().toISOString();
  // Claim ahead of the large due email backlog (global ORDER BY next_run_at ASC).
  const claimAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  console.log(`Claim priority next_run_at=${claimAt}`);

  if (reactivateLimited.length > 0) {
    const cancelled = await cancelColdPathJobs(
      supabase,
      reactivateLimited.map((c) => c.enrollment.id),
      now,
    );
    console.log(`Cancelled cold-path jobs: ${cancelled}`);

    const reactivated = await reactivateOntoCategorizer(
      supabase,
      reactivateLimited,
      categorizer.id as string,
      flowVersion,
      now,
      claimAt,
    );
    console.log(`Reactivated ${reactivated}/${reactivateLimited.length}.`);
  }

  if (prioritizeLimited.length > 0) {
    const prioritized = await prioritizeExistingCohort(
      supabase,
      prioritizeLimited,
      [categorizer.id as string, link.id as string],
      flowVersion,
      now,
      claimAt,
    );
    console.log(`Prioritized ${prioritized}/${prioritizeLimited.length} (pinned Interested thread + claim bump).`);
  }

  console.log('Scheduler should branch Interested → Link and priority-send shortly.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
