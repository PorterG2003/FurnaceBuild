/**
 * Repair enrollments that were incorrectly stopped after transient campaign-load
 * or other retryable Supabase read-path errors.
 *
 * Usage:
 *   npx tsx scripts/repair-transient-error-stopped-enrollments.ts
 *   APPLY=true npx tsx scripts/repair-transient-error-stopped-enrollments.ts
 *   CAMPAIGN_ID=<uuid> npx tsx scripts/repair-transient-error-stopped-enrollments.ts
 *   CAMPAIGN_ID=<uuid> APPLY=true npx tsx scripts/repair-transient-error-stopped-enrollments.ts
 *
 * Resolution order:
 *   1. Load repo `.env.local` / `.env` plus `infra/workers/.env.local` / `.env`
 *   2. Resolve Supabase URL from explicit env, then prod worker env, then dev env
 *   3. Prefer `SUPABASE_SECRET_KEY_PARAM_PATH` (or derive it from worker SSM prefixes)
 *   4. Fall back to `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`
 */

import { isRetryableSupabaseReadError } from '../lib/slack/retryableReadError.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
  ssmParamUnderPrefix,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

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
  status_reason: string | null;
  scheduled_at: string | null;
  message_type: string | null;
  created_at: string;
  error_message: string | null;
};

type Candidate = {
  enrollment: EnrollmentRow;
  queuedCampaignJobs: MessageJobRow[];
  latestCampaignJob: MessageJobRow | null;
};

function isCampaignMessageJob(job: MessageJobRow): boolean {
  return job.message_type === 'campaign' || job.message_type === null;
}

function isQueuedCampaignJob(job: MessageJobRow): boolean {
  return isCampaignMessageJob(job) && ['queued', 'reserved', 'sending'].includes(job.status);
}

async function main() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const campaignId = process.env.CAMPAIGN_ID?.trim();
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
      if (!key) {
        throw error;
      }
      console.warn(
        `[repair-transient-error-stopped-enrollments] Failed to fetch ${secretParamPath}; falling back to existing secret env.`
      );
    }
  }

  if (!url || !key) {
    console.error(
      'Missing Supabase configuration. Provide a resolvable URL plus either SSM worker secret prefixes / SUPABASE_SECRET_KEY_PARAM_PATH, or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY.'
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

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  let campaign:
    | {
        id: string;
        name: string | null;
        status: string | null;
        deleted_at: string | null;
      }
    | null = null;

  if (campaignId) {
    const { data: loadedCampaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('id, name, status, deleted_at')
      .eq('id', campaignId)
      .maybeSingle();

    if (campaignError) {
      console.error('Failed to load campaign:', campaignError.message);
      process.exit(1);
    }

    campaign = loadedCampaign;
  }

  let enrollmentsQuery = supabase
    .from('enrollments')
    .select('id, campaign_id, lead_id, current_node_id, state, stopped_at, stopped_reason, stopped_error_message, next_run_at, deleted_at')
    .eq('state', 'stopped')
    .eq('stopped_reason', 'error')
    .is('deleted_at', null)
    .order('stopped_at', { ascending: false });

  if (campaignId) {
    enrollmentsQuery = enrollmentsQuery.eq('campaign_id', campaignId);
  }

  const { data: enrollments, error: enrollmentsError } = await enrollmentsQuery;

  if (enrollmentsError) {
    console.error('Failed to load error-stopped enrollments:', enrollmentsError.message);
    process.exit(1);
  }

  const stoppedRows = (enrollments ?? []) as EnrollmentRow[];
  const retryableRows = stoppedRows.filter((row) =>
    isRetryableSupabaseReadError(row.stopped_error_message ?? '')
  );

  const enrollmentIds = [...new Set(retryableRows.map((row) => row.id))];
  const jobsByEnrollment = new Map<string, MessageJobRow[]>();

  if (enrollmentIds.length > 0) {
    const { data: messageJobs, error: messageJobsError } = await supabase
      .from('message_jobs')
      .select('id, enrollment_id, status, status_reason, scheduled_at, message_type, created_at, error_message')
      .in('enrollment_id', enrollmentIds)
      .order('created_at', { ascending: true });

    if (messageJobsError) {
      console.error('Failed to load related message jobs:', messageJobsError.message);
      process.exit(1);
    }

    for (const job of (messageJobs ?? []) as MessageJobRow[]) {
      const jobs = jobsByEnrollment.get(job.enrollment_id) ?? [];
      jobs.push(job);
      jobsByEnrollment.set(job.enrollment_id, jobs);
    }
  }

  const candidates: Candidate[] = [];
  const skippedWithQueuedJobs: Candidate[] = [];

  for (const enrollment of retryableRows) {
    const campaignJobs = (jobsByEnrollment.get(enrollment.id) ?? []).filter(
      isCampaignMessageJob
    );
    const queuedCampaignJobs = campaignJobs.filter(isQueuedCampaignJob);
    const latestCampaignJob =
      campaignJobs.length > 0 ? campaignJobs[campaignJobs.length - 1] : null;
    const candidate = { enrollment, queuedCampaignJobs, latestCampaignJob };

    if (queuedCampaignJobs.length > 0) {
      skippedWithQueuedJobs.push(candidate);
      continue;
    }

    candidates.push(candidate);
  }

  console.log(`Campaign scope: ${campaignId ?? 'ALL'}`);
  if (campaignId) {
    console.log(`Campaign name: ${campaign?.name ?? '<unknown>'}`);
    console.log(`Campaign status: ${campaign?.status ?? '<missing>'}`);
    console.log(`Campaign deleted_at: ${campaign?.deleted_at ?? '<null>'}`);
  }
  console.log(`Error-stopped rows: ${stoppedRows.length}`);
  console.log(`Retryable transient rows: ${retryableRows.length}`);
  console.log(`Skipped due to queued campaign jobs: ${skippedWithQueuedJobs.length}`);
  console.log(`Repair candidates: ${candidates.length}`);

  if (!campaignId && retryableRows.length > 0) {
    const byCampaign = new Map<string, { retryable: number; candidates: number; skipped: number }>();
    for (const row of retryableRows) {
      const current = byCampaign.get(row.campaign_id) ?? {
        retryable: 0,
        candidates: 0,
        skipped: 0,
      };
      current.retryable += 1;
      byCampaign.set(row.campaign_id, current);
    }
    for (const { enrollment } of candidates) {
      const current = byCampaign.get(enrollment.campaign_id);
      if (current) current.candidates += 1;
    }
    for (const { enrollment } of skippedWithQueuedJobs) {
      const current = byCampaign.get(enrollment.campaign_id);
      if (current) current.skipped += 1;
    }
    console.log('Per-campaign breakdown:');
    for (const [id, counts] of [...byCampaign.entries()].sort(
      (a, b) => b[1].candidates - a[1].candidates
    )) {
      console.log(
        `- campaign_id=${id} retryable=${counts.retryable} candidates=${counts.candidates} skipped_with_live_jobs=${counts.skipped}`
      );
    }
  }

  if (retryableRows.length > 0) {
    const grouped = new Map<string, number>();
    for (const row of retryableRows) {
      const message = row.stopped_error_message ?? '<null>';
      grouped.set(message, (grouped.get(message) ?? 0) + 1);
    }
    console.log('Retryable stopped_error_message breakdown:');
    for (const [message, count] of [...grouped.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`- count=${count} message=${message}`);
    }
  }

  if (candidates.length > 0) {
    console.log('Preview:');
    console.log(
      JSON.stringify(
        candidates.slice(0, 25).map(({ enrollment }) => ({
          enrollment_id: enrollment.id,
          campaign_id: enrollment.campaign_id,
          lead_id: enrollment.lead_id,
          current_node_id: enrollment.current_node_id,
          stopped_at: enrollment.stopped_at,
          stopped_error_message: enrollment.stopped_error_message,
        })),
        null,
        2
      )
    );
  }

  if (skippedWithQueuedJobs.length > 0) {
    console.log('Skipped preview (queued campaign jobs still exist):');
    console.log(
      JSON.stringify(
        skippedWithQueuedJobs.slice(0, 25).map(({ enrollment, queuedCampaignJobs }) => ({
          enrollment_id: enrollment.id,
          campaign_id: enrollment.campaign_id,
          queued_job_ids: queuedCampaignJobs.map((job) => job.id),
          queued_job_statuses: queuedCampaignJobs.map((job) => ({
            id: job.id,
            status: job.status,
            scheduled_at: job.scheduled_at,
          })),
          stopped_error_message: enrollment.stopped_error_message,
        })),
        null,
        2
      )
    );
  }

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

  for (const candidate of candidates) {
    const latestRetryableFailedJob =
      candidate.latestCampaignJob &&
      candidate.latestCampaignJob.status === 'failed' &&
      isRetryableSupabaseReadError(candidate.latestCampaignJob.error_message ?? '')
        ? candidate.latestCampaignJob
        : null;

    if (latestRetryableFailedJob) {
      const { error: jobUpdateError } = await supabase
        .from('message_jobs')
        .update({
          status: 'deferred',
          status_reason: 'transient_read_error',
          reserved_at: null,
          error_message: latestRetryableFailedJob.error_message,
          updated_at: now,
        } as any)
        .eq('id', latestRetryableFailedJob.id)
        .eq('status', 'failed');

      if (jobUpdateError) {
        console.error(
          `Failed to convert message job ${latestRetryableFailedJob.id} to deferred: ${jobUpdateError.message}`
        );
        process.exit(1);
      }
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from('enrollments')
      .update({
        state: 'active',
        stopped_reason: null,
        stopped_at: null,
        stopped_error_message: null,
        next_run_at: now,
        updated_at: now,
      })
      .eq('id', candidate.enrollment.id)
      .eq('state', 'stopped')
      .eq('stopped_reason', 'error')
      .select('id');

    if (updateError) {
      console.error(`Failed to repair enrollment ${candidate.enrollment.id}: ${updateError.message}`);
      process.exit(1);
    }

    repaired += updatedRows?.length ?? 0;
  }

  console.log(
    `Reactivated ${repaired} enrollments. Latest retryable failed attempts were converted to deferred when present so scheduler retries follow the normal path.`
  );
}

main();
