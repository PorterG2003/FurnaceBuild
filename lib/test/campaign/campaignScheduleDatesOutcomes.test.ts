import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';
import { localMidnightUtcIso } from '../../campaigns/lifecycleSchedule';

const PAST_DUE = '2000-01-01T00:00:00.000Z';

function claimedIds(data: unknown): Set<string> {
  return new Set((Array.isArray(data) ? data : []).map((row: { id?: string }) => String(row.id)));
}

function assertSameInstant(actual: string | null | undefined, expectedIso: string) {
  assert.equal(Date.parse(actual ?? ''), Date.parse(expectedIso), `${actual} !== ${expectedIso}`);
}

async function deleteCampaigns(harness: CampaignDbHarness, campaignIds: string[]) {
  for (let i = 0; i < campaignIds.length; i += 250) {
    const chunk = campaignIds.slice(i, i + 250);
    const { error } = await harness.supabase.from('campaigns').delete().in('id', chunk);
    assert.equal(error, null, error?.message);
  }
}

test('empty start launches to running and future start launches to scheduled', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('sched-launch') });
  try {
    const immediate = await harness.createCampaignGraph({
      name: 'Immediate Start',
      status: 'draft',
      flowKind: 'emailOnly',
      scheduleTimezone: 'America/Chicago',
      startDate: null,
      leads: [buildCampaignLead({ key: 'lead', email: `imm-${harness.namespace}@furnace.test` })],
    });
    const future = await harness.createCampaignGraph({
      name: 'Future Start',
      status: 'draft',
      flowKind: 'emailOnly',
      scheduleTimezone: 'America/Chicago',
      startDate: '2099-01-15',
      leads: [buildCampaignLead({ key: 'lead', email: `fut-${harness.namespace}@furnace.test` })],
    });

    const { error: runErr } = await harness.supabase
      .from('campaigns')
      .update({ status: 'running' })
      .eq('id', immediate.campaignId);
    assert.equal(runErr, null);
    const { error: schedErr } = await harness.supabase
      .from('campaigns')
      .update({ status: 'scheduled' })
      .eq('id', future.campaignId);
    assert.equal(schedErr, null);

    const { data: rows, error } = await harness.supabase
      .from('campaigns')
      .select('id, status, start_date, start_at, schedule_timezone')
      .in('id', [immediate.campaignId, future.campaignId]);
    assert.equal(error, null);
    const byId = new Map((rows ?? []).map((row: any) => [row.id, row]));
    assert.equal(byId.get(immediate.campaignId)?.status, 'running');
    assert.equal(byId.get(immediate.campaignId)?.start_date, null);
    assert.equal(byId.get(future.campaignId)?.status, 'scheduled');
    assert.equal(byId.get(future.campaignId)?.start_date, '2099-01-15');
    assertSameInstant(
      byId.get(future.campaignId)?.start_at,
      localMidnightUtcIso('2099-01-15', 'America/Chicago'),
    );
  } finally {
    await harness.cleanup();
  }
});

test('scheduled campaigns cannot be claimed until the start boundary, then the due tick starts them once', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('sched-start-tick') });
  try {
    const graph = await harness.createCampaignGraph({
      name: 'Due Start',
      status: 'scheduled',
      flowKind: 'emailOnly',
      scheduleTimezone: 'America/Chicago',
      startDate: '2020-01-01',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `due-start-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            nextRunAt: PAST_DUE,
          }),
        }),
      ],
    });
    const enrollmentId = graph.leadsByKey.get('lead')!.enrollmentId!;

    const before = await harness.supabase.rpc('claim_enrollments_ready', {
      p_batch_size: 20,
      p_processing_timeout_minutes: 5,
    });
    assert.equal(before.error, null);
    assert.equal(claimedIds(before.data).has(enrollmentId), false);

    const firstTick = await harness.supabase.rpc('process_due_campaign_schedule_transitions', {
      p_batch_size: 50,
    });
    assert.equal(firstTick.error, null);
    assert.ok((firstTick.data as number) >= 1);

    const { data: afterTick, error: statusError } = await harness.supabase
      .from('campaigns')
      .select('status')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(statusError, null);
    assert.equal(afterTick?.status, 'running');

    const secondTick = await harness.supabase.rpc('process_due_campaign_schedule_transitions', {
      p_batch_size: 50,
    });
    assert.equal(secondTick.error, null);

    const claimed = await harness.supabase.rpc('claim_enrollments_ready', {
      p_batch_size: 20,
      p_processing_timeout_minutes: 5,
    });
    assert.equal(claimed.error, null);
    assert.equal(claimedIds(claimed.data).has(enrollmentId), true);
  } finally {
    await harness.cleanup();
  }
});

test('pause boundary blocks claims immediately and the tick pauses, defers jobs, and clears next_run_at', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('sched-pause-tick') });
  try {
    const graph = await harness.createCampaignGraph({
      name: 'Due Pause',
      status: 'running',
      flowKind: 'emailOnly',
      scheduleTimezone: 'America/Chicago',
      startDate: '2020-01-01',
      pauseDate: '2020-01-02',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `due-pause-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            nextRunAt: PAST_DUE,
          }),
          jobs: [
            buildCampaignJob({
              key: 'queued',
              status: 'queued',
              scheduledAt: PAST_DUE,
            }),
            buildCampaignJob({
              key: 'reserved',
              status: 'reserved',
              reservedAt: PAST_DUE,
              scheduledAt: PAST_DUE,
            }),
            buildCampaignJob({
              key: 'sending',
              status: 'sending',
              sendingStartedAt: PAST_DUE,
              scheduledAt: PAST_DUE,
            }),
          ],
        }),
      ],
    });
    const lead = graph.leadsByKey.get('lead')!;
    const queuedId = lead.messageJobIdsByKey.get('queued')!;
    const reservedId = lead.messageJobIdsByKey.get('reserved')!;
    const sendingId = lead.messageJobIdsByKey.get('sending')!;

    const enrollClaim = await harness.supabase.rpc('claim_enrollments_ready', {
      p_batch_size: 20,
      p_processing_timeout_minutes: 5,
    });
    assert.equal(enrollClaim.error, null);
    assert.equal(claimedIds(enrollClaim.data).has(lead.enrollmentId!), false);

    const jobClaim = await harness.supabase.rpc('claim_message_jobs_ready', {
      p_batch_size: 20,
      p_processing_timeout_minutes: 5,
    });
    assert.equal(jobClaim.error, null);
    const claimedJobIds = claimedIds(jobClaim.data);
    assert.equal(claimedJobIds.has(queuedId), false);

    const markReserved = await harness.supabase.rpc('try_mark_campaign_message_job_sending', {
      p_message_job_id: reservedId,
    });
    assert.equal(markReserved.error, null);
    assert.equal(markReserved.data, false);

    const markSending = await harness.supabase.rpc('try_mark_campaign_message_job_sending', {
      p_message_job_id: sendingId,
    });
    assert.equal(markSending.error, null);
    assert.equal(markSending.data, false);

    const tick = await harness.supabase.rpc('process_due_campaign_schedule_transitions', {
      p_batch_size: 50,
    });
    assert.equal(tick.error, null);
    assert.ok((tick.data as number) >= 1);

    const { data: campaign, error: campaignError } = await harness.supabase
      .from('campaigns')
      .select('status')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(campaignError, null);
    assert.equal(campaign?.status, 'paused');

    const { data: jobs, error: jobsError } = await harness.supabase
      .from('message_jobs')
      .select('id, status, status_reason')
      .in('id', [queuedId, reservedId, sendingId]);
    assert.equal(jobsError, null);
    const jobById = new Map((jobs ?? []).map((row: any) => [row.id, row]));
    assert.equal(jobById.get(queuedId)?.status, 'deferred');
    assert.equal(jobById.get(queuedId)?.status_reason, 'campaign_paused');
    assert.equal(jobById.get(reservedId)?.status, 'deferred');
    assert.equal(jobById.get(reservedId)?.status_reason, 'campaign_paused');
    assert.equal(jobById.get(sendingId)?.status, 'sending');

    const { data: enrollment, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('next_run_at, state')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollmentError, null);
    assert.equal(enrollment?.state, 'active');
    assert.equal(enrollment?.next_run_at, null);

    const repeat = await harness.supabase.rpc('process_due_campaign_schedule_transitions', {
      p_batch_size: 50,
    });
    assert.equal(repeat.error, null);
  } finally {
    await harness.cleanup();
  }
});

test('24/7 campaigns keep timezone and DST local dates materialize the expected UTC instants', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('sched-tz') });
  try {
    const graph = await harness.createCampaignGraph({
      name: 'Always On Dates',
      status: 'scheduled',
      flowKind: 'emailOnly',
      schedule: null,
      scheduleTimezone: 'America/Chicago',
      startDate: '2026-03-08',
      pauseDate: '2026-11-02',
      leads: [],
    });

    const { data, error } = await harness.supabase
      .from('campaigns')
      .select('schedule, schedule_timezone, start_date, pause_date, start_at, pause_at')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(error, null);
    assert.equal(data?.schedule, null);
    assert.equal(data?.schedule_timezone, 'America/Chicago');
    assertSameInstant(data?.start_at, localMidnightUtcIso('2026-03-08', 'America/Chicago'));
    assertSameInstant(data?.pause_at, localMidnightUtcIso('2026-11-02', 'America/Chicago'));
  } finally {
    await harness.cleanup();
  }
});

test('moving or clearing dates and elapsed-pause resume produce the specified states', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('sched-edits') });
  try {
    const scheduled = await harness.createCampaignGraph({
      name: 'Edit Scheduled',
      status: 'scheduled',
      flowKind: 'emailOnly',
      scheduleTimezone: 'America/Chicago',
      startDate: '2099-06-01',
      pauseDate: '2099-07-01',
      leads: [],
    });

    const { error: startNowError } = await harness.supabase
      .from('campaigns')
      .update({ start_date: null, status: 'running' })
      .eq('id', scheduled.campaignId);
    assert.equal(startNowError, null);
    const { data: started } = await harness.supabase
      .from('campaigns')
      .select('status, start_date, start_at')
      .eq('id', scheduled.campaignId)
      .single();
    assert.equal(started?.status, 'running');
    assert.equal(started?.start_date, null);
    assert.equal(started?.start_at, null);

    const running = await harness.createCampaignGraph({
      name: 'Edit Pause',
      status: 'running',
      flowKind: 'emailOnly',
      scheduleTimezone: 'America/Chicago',
      pauseDate: '2099-08-01',
      leads: [],
    });
    const { error: clearPauseError } = await harness.supabase
      .from('campaigns')
      .update({ pause_date: null })
      .eq('id', running.campaignId);
    assert.equal(clearPauseError, null);
    const { data: cleared } = await harness.supabase
      .from('campaigns')
      .select('pause_date, pause_at, status')
      .eq('id', running.campaignId)
      .single();
    assert.equal(cleared?.pause_date, null);
    assert.equal(cleared?.pause_at, null);
    assert.equal(cleared?.status, 'running');

    const elapsed = await harness.createCampaignGraph({
      name: 'Elapsed Pause Resume',
      status: 'paused',
      flowKind: 'emailOnly',
      scheduleTimezone: 'America/Chicago',
      startDate: '2020-01-01',
      pauseDate: '2020-01-02',
      leads: [],
    });
    const { error: resumeError } = await harness.supabase
      .from('campaigns')
      .update({ status: 'running' })
      .eq('id', elapsed.campaignId);
    assert.ok(resumeError);
    const { data: stillPaused } = await harness.supabase
      .from('campaigns')
      .select('status')
      .eq('id', elapsed.campaignId)
      .single();
    assert.equal(stillPaused?.status, 'paused');
  } finally {
    await harness.cleanup();
  }
});

test('due start and pause lookups use the partial indexes on a 10k-row seed', { timeout: 180_000 }, async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('sched-explain') });
  const extraCampaignIds: string[] = [];
  try {
    await harness.createCampaignGraph({
      name: 'Explain Seed Anchor',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });

    const futureRows = Array.from({ length: 10000 }, (_, index) => ({
      id: randomUUID(),
      name: `${harness.namespace}-future-${index}`,
      owner_id: harness.env.ownerUserId,
      account_id: harness.env.accountId,
      status: 'scheduled' as const,
      schedule_timezone: 'America/Chicago',
      start_date: '2099-01-01',
      sending_interval_seconds: 300,
    }));
    const dueRows = Array.from({ length: 25 }, (_, index) => ({
      id: randomUUID(),
      name: `${harness.namespace}-due-${index}`,
      owner_id: harness.env.ownerUserId,
      account_id: harness.env.accountId,
      status: 'scheduled' as const,
      schedule_timezone: 'America/Chicago',
      start_date: '2020-01-01',
      sending_interval_seconds: 300,
    }));
    const pauseRows = Array.from({ length: 25 }, (_, index) => ({
      id: randomUUID(),
      name: `${harness.namespace}-pause-${index}`,
      owner_id: harness.env.ownerUserId,
      account_id: harness.env.accountId,
      status: 'running' as const,
      schedule_timezone: 'America/Chicago',
      start_date: '2020-01-01',
      pause_date: '2020-01-02',
      sending_interval_seconds: 300,
    }));

    for (const batch of [futureRows, dueRows, pauseRows]) {
      for (let i = 0; i < batch.length; i += 250) {
        const chunk = batch.slice(i, i + 250);
        const { data, error } = await harness.supabase
          .from('campaigns')
          .insert(chunk)
          .select('id');
        assert.equal(error, null, error?.message);
        for (const row of data ?? []) {
          extraCampaignIds.push(row.id);
        }
      }
    }

    const starts = await harness.supabase.rpc('explain_due_campaign_schedule_starts');
    assert.equal(starts.error, null, starts.error?.message);
    const startPlan = ((starts.data ?? []) as Array<{ plan: string }>).map((row) => row.plan).join('\n');
    assert.match(startPlan, /campaigns_scheduled_start_due_idx/);
    assert.doesNotMatch(startPlan, /Seq Scan on campaigns/);

    const pauses = await harness.supabase.rpc('explain_due_campaign_schedule_pauses');
    assert.equal(pauses.error, null, pauses.error?.message);
    const pausePlan = ((pauses.data ?? []) as Array<{ plan: string }>).map((row) => row.plan).join('\n');
    assert.match(pausePlan, /campaigns_running_pause_due_idx/);
    assert.doesNotMatch(pausePlan, /Seq Scan on campaigns/);
  } finally {
    await deleteCampaigns(harness, extraCampaignIds);
    await harness.cleanup();
  }
});
