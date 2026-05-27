import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

async function loadGlobalLeadId(harness: CampaignDbHarness, leadId: string): Promise<string> {
  const { data, error } = await harness.supabase
    .from('leads')
    .select('global_lead_id')
    .eq('id', leadId)
    .single();
  assert.equal(error, null);
  return data!.global_lead_id as string;
}

test('pause_enrollments_for_leads defers queued job and pauses enrollment', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('enr-pause-queued') });
  const email = `pause-queued-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Pause Queued',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'job', status: 'queued' })],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead')!;
    const globalLeadId = await loadGlobalLeadId(harness, lead.leadId);
    const jobId = [...lead.messageJobIdsByKey.values()][0]!;

    const { data, error } = await harness.supabase.rpc('pause_enrollments_for_leads', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(error, null);
    assert.equal((data as { paused: number }).paused, 1);
    assert.equal((data as { skipped: number }).skipped, 0);

    const { data: enrollment, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('state, next_run_at')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollmentError, null);
    assert.equal(enrollment?.state, 'paused');
    assert.equal(enrollment?.next_run_at, null);

    const { data: job, error: jobError } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason')
      .eq('id', jobId)
      .single();
    assert.equal(jobError, null);
    assert.equal(job?.status, 'deferred');
    assert.equal(job?.status_reason, 'enrollment_paused');
  } finally {
    await harness.cleanup();
  }
});

test('pause_enrollments_for_leads defers reserved job and leaves sending unchanged', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('enr-pause-mixed') });
  const emailReserved = `pause-reserved-${harness.namespace}@furnace.test`;
  const emailSending = `pause-sending-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Pause Mixed Jobs',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'reserved',
          email: emailReserved,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'reserved-job', status: 'reserved', reservedAt: new Date().toISOString() })],
        }),
        buildCampaignLead({
          key: 'sending',
          email: emailSending,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sending-job', status: 'sending' })],
        }),
      ],
    });

    const reservedLead = graph.leadsByKey.get('reserved')!;
    const sendingLead = graph.leadsByKey.get('sending')!;
    const globalLeadIds = await Promise.all([
      loadGlobalLeadId(harness, reservedLead.leadId),
      loadGlobalLeadId(harness, sendingLead.leadId),
    ]);

    const { error } = await harness.supabase.rpc('pause_enrollments_for_leads', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: globalLeadIds,
    });
    assert.equal(error, null);

    const reservedJobId = [...reservedLead.messageJobIdsByKey.values()][0]!;
    const sendingJobId = [...sendingLead.messageJobIdsByKey.values()][0]!;

    const { data: jobs, error: jobsError } = await harness.supabase
      .from('message_jobs')
      .select('id, status, status_reason')
      .in('id', [reservedJobId, sendingJobId]);
    assert.equal(jobsError, null);
    const byId = new Map((jobs ?? []).map((row: any) => [row.id, row]));
    assert.equal(byId.get(reservedJobId)?.status, 'deferred');
    assert.equal(byId.get(reservedJobId)?.status_reason, 'enrollment_paused');
    assert.equal(byId.get(sendingJobId)?.status, 'sending');
  } finally {
    await harness.cleanup();
  }
});

test('pause_enrollments_for_leads preserves throttle and campaign_paused deferrals', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('enr-pause-preserve') });
  const email = `pause-preserve-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Pause Preserve Deferrals',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({
              key: 'throttle',
              status: 'deferred',
              statusReason: 'daily_throttle_limit',
            }),
            buildCampaignJob({
              key: 'campaign-paused',
              status: 'deferred',
              statusReason: 'campaign_paused',
            }),
            buildCampaignJob({ key: 'queued', status: 'queued' }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead')!;
    const globalLeadId = await loadGlobalLeadId(harness, lead.leadId);
    const jobIds = [...lead.messageJobIdsByKey.entries()];
    const throttleId = lead.messageJobIdsByKey.get('throttle')!;
    const campaignPausedId = lead.messageJobIdsByKey.get('campaign-paused')!;

    const { error } = await harness.supabase.rpc('pause_enrollments_for_leads', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(error, null);

    const { data: jobs, error: jobsError } = await harness.supabase
      .from('message_jobs')
      .select('id, status, status_reason')
      .in('id', jobIds.map(([, id]) => id));
    assert.equal(jobsError, null);
    const byId = new Map((jobs ?? []).map((row: any) => [row.id, row]));
    assert.equal(byId.get(throttleId)?.status_reason, 'daily_throttle_limit');
    assert.equal(byId.get(campaignPausedId)?.status_reason, 'campaign_paused');
  } finally {
    await harness.cleanup();
  }
});

test('resume_enrollments_for_leads restores paused enrollment and re-queues enrollment_paused jobs', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('enr-resume') });
  const email = `resume-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Resume Happy',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'job', status: 'queued' })],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead')!;
    const globalLeadId = await loadGlobalLeadId(harness, lead.leadId);
    const jobId = [...lead.messageJobIdsByKey.values()][0]!;

    await harness.supabase.rpc('pause_enrollments_for_leads', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });

    const { data, error } = await harness.supabase.rpc('resume_enrollments_for_leads', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(error, null);
    assert.equal((data as { resumed: number }).resumed, 1);
    assert.equal((data as { skipped: number }).skipped, 0);

    const { data: enrollment, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('state, next_run_at')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollmentError, null);
    assert.equal(enrollment?.state, 'active');
    assert.ok(enrollment?.next_run_at);

    const { data: job, error: jobError } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason')
      .eq('id', jobId)
      .single();
    assert.equal(jobError, null);
    assert.equal(job?.status, 'queued');
    assert.equal(job?.status_reason, null);
  } finally {
    await harness.cleanup();
  }
});

test('resume_enrollments_for_leads blocked when campaign not running', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('enr-resume-block') });
  const email = `resume-block-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Resume Block',
      status: 'paused',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email,
          enrollment: buildCampaignEnrollment({ state: 'paused' }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead')!;
    const globalLeadId = await loadGlobalLeadId(harness, lead.leadId);

    const { error } = await harness.supabase.rpc('resume_enrollments_for_leads', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.ok(error);
    assert.match(error.message, /running/i);

    const { data: enrollment, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('state')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollmentError, null);
    assert.equal(enrollment?.state, 'paused');
  } finally {
    await harness.cleanup();
  }
});

test('campaign resume ignores manually paused enrollments', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('enr-ortho') });
  const emailManual = `manual-pause-${harness.namespace}@furnace.test`;
  const emailActive = `active-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Orthogonality',
      status: 'paused',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'manual',
          email: emailManual,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'manual-job', status: 'queued' })],
        }),
        buildCampaignLead({
          key: 'active',
          email: emailActive,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'active-job', status: 'queued' })],
        }),
      ],
    });

    const manualLead = graph.leadsByKey.get('manual')!;
    const activeLead = graph.leadsByKey.get('active')!;
    const manualGlobalId = await loadGlobalLeadId(harness, manualLead.leadId);

    await harness.supabase.rpc('pause_enrollments_for_leads', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [manualGlobalId],
    });

    await harness.supabase.rpc('pause_campaign_and_defer_jobs', {
      p_campaign_id: graph.campaignId,
    });

    await harness.supabase.rpc('resume_campaign_and_reschedule_jobs', {
      p_campaign_id: graph.campaignId,
      p_pause_reason: 'Campaign paused',
    });

    const { data: enrollments, error } = await harness.supabase
      .from('enrollments')
      .select('id, state')
      .in('id', [manualLead.enrollmentId!, activeLead.enrollmentId!]);
    assert.equal(error, null);
    const byId = new Map((enrollments ?? []).map((row: any) => [row.id, row.state]));
    assert.equal(byId.get(manualLead.enrollmentId!), 'paused');
    assert.equal(byId.get(activeLead.enrollmentId!), 'active');
  } finally {
    await harness.cleanup();
  }
});

test('pause and resume mutation skip counts reflect unmutated selections', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('enr-skip-counts') });
  const emailActive = `skip-active-${harness.namespace}@furnace.test`;
  const emailPaused = `skip-paused-${harness.namespace}@furnace.test`;
  const emailMissing = `skip-missing-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Skip Counts',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'active',
          email: emailActive,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
        buildCampaignLead({
          key: 'paused',
          email: emailPaused,
          enrollment: buildCampaignEnrollment({ state: 'paused' }),
        }),
      ],
    });

    const activeGlobalId = await loadGlobalLeadId(harness, graph.leadsByKey.get('active')!.leadId);
    const pausedGlobalId = await loadGlobalLeadId(harness, graph.leadsByKey.get('paused')!.leadId);
    const missingGlobalId = hashGlobalLeadId(emailMissing);

    const { data: pauseData, error: pauseError } = await harness.supabase.rpc(
      'pause_enrollments_for_leads',
      {
        p_account_id: harness.env.accountId,
        p_campaign_id: graph.campaignId,
        p_global_lead_ids: [activeGlobalId, pausedGlobalId, missingGlobalId],
      },
    );
    assert.equal(pauseError, null);
    assert.equal((pauseData as { paused: number }).paused, 1);
    assert.equal((pauseData as { skipped: number }).skipped, 2);

    const { data: resumeData, error: resumeError } = await harness.supabase.rpc(
      'resume_enrollments_for_leads',
      {
        p_account_id: harness.env.accountId,
        p_campaign_id: graph.campaignId,
        p_global_lead_ids: [activeGlobalId, pausedGlobalId, missingGlobalId],
      },
    );
    assert.equal(resumeError, null);
    assert.equal((resumeData as { resumed: number }).resumed, 2);
    assert.equal((resumeData as { skipped: number }).skipped, 1);
  } finally {
    await harness.cleanup();
  }
});

test('pause and resume review summaries return expected counts', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('enr-review') });
  const emailActive = `review-active-${harness.namespace}@furnace.test`;
  const emailPaused = `review-paused-${harness.namespace}@furnace.test`;
  const emailMissing = `review-missing-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Review Summary',
      status: 'paused',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'active',
          email: emailActive,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
        buildCampaignLead({
          key: 'paused',
          email: emailPaused,
          enrollment: buildCampaignEnrollment({ state: 'paused' }),
        }),
      ],
    });

    const activeGlobalId = await loadGlobalLeadId(harness, graph.leadsByKey.get('active')!.leadId);
    const pausedGlobalId = await loadGlobalLeadId(harness, graph.leadsByKey.get('paused')!.leadId);
    const missingGlobalId = hashGlobalLeadId(emailMissing);

    const { data: pauseSummary, error: pauseError } = await harness.supabase.rpc(
      'pause_enrollments_review_summary',
      {
        p_account_id: harness.env.accountId,
        p_campaign_id: graph.campaignId,
        p_global_lead_ids: [activeGlobalId, pausedGlobalId, missingGlobalId],
      },
    );
    assert.equal(pauseError, null);
    assert.equal((pauseSummary as { activeInCampaign: number }).activeInCampaign, 1);
    assert.equal((pauseSummary as { alreadyPausedInCampaign: number }).alreadyPausedInCampaign, 1);
    assert.equal((pauseSummary as { notInCampaign: number }).notInCampaign, 1);

    const { data: resumeSummary, error: resumeError } = await harness.supabase.rpc(
      'resume_enrollments_review_summary',
      {
        p_account_id: harness.env.accountId,
        p_campaign_id: graph.campaignId,
        p_global_lead_ids: [activeGlobalId, pausedGlobalId],
      },
    );
    assert.equal(resumeError, null);
    assert.equal((resumeSummary as { pausedInCampaign: number }).pausedInCampaign, 1);
    assert.equal((resumeSummary as { campaignNotRunning: boolean }).campaignNotRunning, true);
  } finally {
    await harness.cleanup();
  }
});
