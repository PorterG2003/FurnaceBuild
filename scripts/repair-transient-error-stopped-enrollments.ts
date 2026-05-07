/**
 * Repair enrollments that were incorrectly stopped after transient campaign-load
 * or other retryable Supabase read-path errors.
 *
 * Usage:
 *   CAMPAIGN_ID=<uuid> SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/repair-transient-error-stopped-enrollments.ts
 *   CAMPAIGN_ID=<uuid> APPLY=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/repair-transient-error-stopped-enrollments.ts
 */

import { isRetryableSupabaseReadError } from '../lib/slack/retryableReadError.js';

type EnrollmentRow = {
  id: string;
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
  scheduled_at: string | null;
  message_type: string | null;
  created_at: string;
};

type Candidate = {
  enrollment: EnrollmentRow;
  queuedCampaignJobs: MessageJobRow[];
};

function isCampaignMessageJob(job: MessageJobRow): boolean {
  return job.message_type === 'campaign' || job.message_type === null;
}

function isQueuedCampaignJob(job: MessageJobRow): boolean {
  return isCampaignMessageJob(job) && ['queued', 'reserved', 'sending'].includes(job.status);
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const campaignId = process.env.CAMPAIGN_ID?.trim();
  const apply = process.env.APPLY === 'true';

  if (!url || !key || !campaignId) {
    console.error(
      'Set CAMPAIGN_ID plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).'
    );
    process.exit(1);
  }

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

  const { data: enrollments, error: enrollmentsError } = await supabase
    .from('enrollments')
    .select('id, lead_id, current_node_id, state, stopped_at, stopped_reason, stopped_error_message, next_run_at, deleted_at')
    .eq('campaign_id', campaignId)
    .eq('state', 'stopped')
    .eq('stopped_reason', 'error')
    .is('deleted_at', null)
    .order('stopped_at', { ascending: false });

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
      .select('id, enrollment_id, status, scheduled_at, message_type, created_at')
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
    const queuedCampaignJobs = (jobsByEnrollment.get(enrollment.id) ?? []).filter(isQueuedCampaignJob);
    const candidate = { enrollment, queuedCampaignJobs };

    if (queuedCampaignJobs.length > 0) {
      skippedWithQueuedJobs.push(candidate);
      continue;
    }

    candidates.push(candidate);
  }

  console.log(`Campaign: ${campaignId}`);
  console.log(`Campaign name: ${campaign?.name ?? '<unknown>'}`);
  console.log(`Campaign status: ${campaign?.status ?? '<missing>'}`);
  console.log(`Campaign deleted_at: ${campaign?.deleted_at ?? '<null>'}`);
  console.log(`Error-stopped rows: ${stoppedRows.length}`);
  console.log(`Retryable transient rows: ${retryableRows.length}`);
  console.log(`Skipped due to queued campaign jobs: ${skippedWithQueuedJobs.length}`);
  console.log(`Repair candidates: ${candidates.length}`);

  if (retryableRows.length > 0) {
    const grouped = new Map<string, number>();
    for (const row of retryableRows) {
      const key = row.stopped_error_message ?? '<null>';
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
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
  const candidateIds = candidates.map(({ enrollment }) => enrollment.id);

  const { data: updated, error: updateError } = await supabase
    .from('enrollments')
    .update({
      state: 'active',
      stopped_reason: null,
      stopped_at: null,
      stopped_error_message: null,
      next_run_at: now,
      updated_at: now,
    })
    .in('id', candidateIds)
    .eq('state', 'stopped')
    .eq('stopped_reason', 'error')
    .select('id');

  if (updateError) {
    console.error('Failed to repair enrollments:', updateError.message);
    process.exit(1);
  }

  console.log(
    `Reactivated ${updated?.length ?? 0} enrollments. Campaign message job timing remains unchanged; scheduling will continue through the normal scheduler path.`
  );
}

main();
