/**
 * Repair historical enrollments that skipped a paused email after the old
 * pause implementation rewrote queued jobs to cancelled.
 *
 * Usage:
 *   CAMPAIGN_ID=<uuid> SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/repair-pause-cancelled-enrollments.ts
 *   CAMPAIGN_ID=<uuid> APPLY=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/repair-pause-cancelled-enrollments.ts
 */

type MessageJobRow = {
  id: string;
  enrollment_id: string;
  node_id: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  scheduled_at: string | null;
};

type EnrollmentRow = {
  id: string;
  lead_id: string;
  current_node_id: string | null;
  state: 'active' | 'paused' | 'stopped' | 'completed';
  next_run_at: string | null;
  deleted_at: string | null;
};

type Candidate = {
  enrollment: EnrollmentRow;
  pausedJob: MessageJobRow;
  otherJobs: MessageJobRow[];
};

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

  const { data: pausedJobs, error: pausedJobsError } = await supabase
    .from('message_jobs')
    .select('id, enrollment_id, node_id, status, error_message, created_at, scheduled_at')
    .eq('campaign_id', campaignId)
    .eq('status', 'cancelled')
    .eq('error_message', 'Campaign paused')
    .or('message_type.eq.campaign,message_type.is.null')
    .order('created_at', { ascending: true });

  if (pausedJobsError) {
    console.error('Failed to load paused-cancelled message jobs:', pausedJobsError.message);
    process.exit(1);
  }

  const pausedRows = (pausedJobs ?? []) as MessageJobRow[];
  if (pausedRows.length === 0) {
    console.log('No legacy pause-cancelled campaign jobs found.');
    return;
  }

  const enrollmentIds = [...new Set(pausedRows.map((row) => row.enrollment_id))];
  const { data: enrollments, error: enrollmentsError } = await supabase
    .from('enrollments')
    .select('id, lead_id, current_node_id, state, next_run_at, deleted_at')
    .in('id', enrollmentIds);

  if (enrollmentsError) {
    console.error('Failed to load enrollments:', enrollmentsError.message);
    process.exit(1);
  }

  const { data: allJobs, error: allJobsError } = await supabase
    .from('message_jobs')
    .select('id, enrollment_id, node_id, status, error_message, created_at, scheduled_at')
    .in('enrollment_id', enrollmentIds)
    .order('created_at', { ascending: true });

  if (allJobsError) {
    console.error('Failed to load enrollment message jobs:', allJobsError.message);
    process.exit(1);
  }

  const enrollmentById = new Map<string, EnrollmentRow>(
    ((enrollments ?? []) as EnrollmentRow[]).map((row) => [row.id, row])
  );
  const jobsByEnrollment = new Map<string, MessageJobRow[]>();

  for (const row of (allJobs ?? []) as MessageJobRow[]) {
    const jobs = jobsByEnrollment.get(row.enrollment_id) ?? [];
    jobs.push(row);
    jobsByEnrollment.set(row.enrollment_id, jobs);
  }

  const candidates: Candidate[] = [];

  for (const pausedJob of pausedRows) {
    const enrollment = enrollmentById.get(pausedJob.enrollment_id);
    if (!enrollment || !pausedJob.node_id) continue;
    if (enrollment.deleted_at) continue;
    if (enrollment.state !== 'active') continue;
    if (enrollment.current_node_id === null) continue;
    if (enrollment.current_node_id === pausedJob.node_id) continue;

    const otherJobs = (jobsByEnrollment.get(pausedJob.enrollment_id) ?? []).filter(
      (job) => job.id !== pausedJob.id
    );

    const hasSameNodeSuccessor = otherJobs.some((job) => job.node_id === pausedJob.node_id);
    if (hasSameNodeSuccessor) continue;

    if (otherJobs.length > 0) continue;

    candidates.push({
      enrollment,
      pausedJob,
      otherJobs,
    });
  }

  console.log(`Campaign: ${campaignId}`);
  console.log(`Legacy pause-cancelled jobs: ${pausedRows.length}`);
  console.log(`Repair candidates: ${candidates.length}`);

  if (candidates.length > 0) {
    console.log('Preview:');
    console.log(
      JSON.stringify(
        candidates.map((candidate) => ({
          enrollment_id: candidate.enrollment.id,
          lead_id: candidate.enrollment.lead_id,
          current_node_id: candidate.enrollment.current_node_id,
          paused_job_id: candidate.pausedJob.id,
          paused_job_node_id: candidate.pausedJob.node_id,
          paused_job_created_at: candidate.pausedJob.created_at,
        })),
        null,
        2
      )
    );
  }

  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to repair the candidates.');
    return;
  }

  if (candidates.length === 0) {
    console.log('Nothing to repair.');
    return;
  }

  let repaired = 0;

  for (const candidate of candidates) {
    const now = new Date();
    const nextRunAt = now.toISOString();
    const scheduledAt = new Date(now.getTime() + 30_000).toISOString();

    const { error: enrollmentError } = await supabase
      .from('enrollments')
      .update({
        current_node_id: candidate.pausedJob.node_id,
        next_run_at: nextRunAt,
        updated_at: nextRunAt,
      })
      .eq('id', candidate.enrollment.id)
      .eq('state', 'active')
      .eq('current_node_id', candidate.enrollment.current_node_id);

    if (enrollmentError) {
      console.error(
        `Failed to rewind enrollment ${candidate.enrollment.id}: ${enrollmentError.message}`
      );
      process.exit(1);
    }

    const { error: jobError } = await supabase
      .from('message_jobs')
      .update({
        status: 'pending',
        reserved_at: null,
        scheduled_at: scheduledAt,
        error_message: null,
        updated_at: nextRunAt,
      })
      .eq('id', candidate.pausedJob.id)
      .eq('status', 'cancelled')
      .eq('error_message', 'Campaign paused');

    if (jobError) {
      console.error(
        `Failed to reactivate message job ${candidate.pausedJob.id}: ${jobError.message}`
      );
      process.exit(1);
    }

    repaired += 1;
  }

  console.log(`Repaired ${repaired} enrollment(s).`);
}

main();
