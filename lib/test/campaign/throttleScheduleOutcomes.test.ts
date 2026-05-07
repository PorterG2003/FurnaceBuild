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
import { maintainCampaignIntervals } from '../../../workers/scheduler-worker/src/interval-management';
import { batchAssignIntervalJobs } from '../../../workers/scheduler-worker/src/batch-interval-assignment';

const CHICAGO_SCHEDULE = {
  timezone: 'America/Chicago',
  start_hour: 9,
  start_minute: 0,
  end_hour: 17,
  end_minute: 0,
  days_of_week: [1, 2, 3, 4, 5],
} as const;

function chicagoDateParts(iso: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(iso));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    weekday: values.get('weekday') ?? '',
    hour: Number(values.get('hour') ?? '0'),
    minute: Number(values.get('minute') ?? '0'),
  };
}

function assertInChicagoBusinessHours(iso: string) {
  const { weekday, hour, minute } = chicagoDateParts(iso);
  assert.ok(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday), `expected weekday send, got ${weekday} for ${iso}`);
  assert.ok(hour >= 9, `expected Chicago hour >= 9, got ${hour}:${minute} for ${iso}`);
  assert.ok(hour < 17 || (hour === 17 && minute === 0), `expected Chicago hour <= 17, got ${hour}:${minute} for ${iso}`);
}

async function seedThrottleRow(
  harness: CampaignDbHarness,
  params: {
    mailboxId: string;
    sentCount: number;
    hourlySent?: Record<string, number>;
    dailyLimit?: number;
    hourlyLimit?: number;
    minGapSeconds?: number;
    lastSentAt?: string | null;
  },
) {
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await harness.supabase
    .from('mailbox_throttles')
    .upsert({
      mailbox_id: params.mailboxId,
      account_id: harness.env.accountId,
      date: today,
      sent_count: params.sentCount,
      hourly_sent: params.hourlySent ?? {},
      daily_limit: params.dailyLimit ?? 50,
      hourly_limit: params.hourlyLimit ?? 10,
      min_gap_seconds: params.minGapSeconds ?? 180,
      last_sent_at: params.lastSentAt ?? null,
      updated_at: new Date().toISOString(),
    } as any, {
      onConflict: 'mailbox_id,date',
    });
  assert.equal(error, null);
}

test('daily throttle defers the attempt, preserves the historical interval, and recreates a new queued retry inside campaign hours', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('throttle-daily') });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Throttle Daily Regression',
      status: 'running',
      flowKind: 'emailOnly',
      sendingIntervalSeconds: 3600,
      schedule: CHICAGO_SCHEDULE as any,
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `${harness.namespace}-daily@furnace.test`,
          displayName: 'Throttle Daily Mailbox',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'deferred-daily',
          email: `deferred-daily-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'attempt-1',
              nodeFlowNodeId: 'email-1',
              status: 'reserved',
              reservedAt: new Date(now - 30_000).toISOString(),
              scheduledAt: new Date(now - 15 * 60_000).toISOString(),
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('deferred-daily')!;
    const attemptId = lead.messageJobIdsByKey.get('attempt-1')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    const oldIntervalId = randomUUID();
    const { error: intervalError } = await harness.supabase.from('campaign_intervals').insert({
      id: oldIntervalId,
      campaign_id: graph.campaignId,
      account_id: graph.accountId,
      interval_time: new Date(now - 60 * 60_000).toISOString(),
      status: 'scheduled',
    } as any);
    assert.equal(intervalError, null);

    const { error: intervalAttachError } = await harness.supabase
      .from('message_jobs')
      .update({ interval_id: oldIntervalId } as any)
      .eq('id', attemptId);
    assert.equal(intervalAttachError, null);

    await seedThrottleRow(harness, {
      mailboxId,
      sentCount: 1,
      dailyLimit: 1,
      hourlyLimit: 50,
      minGapSeconds: 60,
      lastSentAt: new Date(now - 5 * 60_000).toISOString(),
    });

    const throttleResult = await harness.supabase
      .rpc('check_mailbox_throttle_and_reserve', {
        p_message_job_id: attemptId,
      })
      .single();
    assert.equal(throttleResult.error, null);
    assert.equal(throttleResult.data?.success, false);
    assert.equal(throttleResult.data?.failure_reason, 'Daily throttle limit exceeded');

    const { data: deferredAttempt, error: deferredAttemptError } = await harness.supabase
      .from('message_jobs')
      .select('id, status, status_reason, interval_id, send_wait_reason')
      .eq('id', attemptId)
      .single();
    assert.equal(deferredAttemptError, null);
    assert.equal(deferredAttempt?.status, 'deferred');
    assert.equal(deferredAttempt?.status_reason, 'daily_throttle_limit');
    assert.equal(deferredAttempt?.interval_id, oldIntervalId);
    assert.equal(deferredAttempt?.send_wait_reason, 'Daily send limit reached for this mailbox');

    const { data: enrollmentRow, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('id, current_node_id, next_run_at, state')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollmentError, null);
    assert.equal(enrollmentRow?.state, 'active');
    assert.equal(enrollmentRow?.current_node_id, graph.nodeIdsByFlowNodeId.get('email-1'));
    assert.ok(enrollmentRow?.next_run_at);
    assert.ok(Date.parse(enrollmentRow!.next_run_at) > now);

    const { error: rearmError } = await harness.supabase
      .from('enrollments')
      .update({ next_run_at: new Date().toISOString() } as any)
      .eq('id', lead.enrollmentId!);
    assert.equal(rearmError, null);

    await maintainCampaignIntervals(harness.supabase as any);
    await batchAssignIntervalJobs(harness.supabase as any, 0);

    const { data: attempts, error: attemptsError } = await harness.supabase
      .from('message_jobs')
      .select('id, status, status_reason, scheduled_at, interval_id, created_at')
      .eq('enrollment_id', lead.enrollmentId!)
      .eq('node_id', graph.nodeIdsByFlowNodeId.get('email-1')!)
      .order('created_at', { ascending: true });
    assert.equal(attemptsError, null);
    assert.equal(attempts?.length, 2);

    const recreatedAttempt = attempts?.find((row: any) => row.id !== attemptId);
    assert.ok(recreatedAttempt);
    assert.equal(recreatedAttempt?.status, 'queued');
    assert.equal(recreatedAttempt?.status_reason, null);
    assert.ok(recreatedAttempt?.interval_id);
    assert.notEqual(recreatedAttempt?.interval_id, oldIntervalId);
    assertInChicagoBusinessHours(recreatedAttempt!.scheduled_at);
  } finally {
    await harness.cleanup();
  }
});

test('minimum-gap throttles mark the attempt deferred and re-arm the enrollment with a future lower bound', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('throttle-gap') });
  const now = Date.now();
  const lastSentAt = new Date(now - 2 * 60_000).toISOString();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Throttle Gap Regression',
      status: 'running',
      flowKind: 'emailOnly',
      schedule: CHICAGO_SCHEDULE as any,
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `${harness.namespace}-gap@furnace.test`,
          displayName: 'Throttle Gap Mailbox',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'deferred-gap',
          email: `deferred-gap-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'attempt-1',
              nodeFlowNodeId: 'email-1',
              status: 'reserved',
              reservedAt: new Date(now - 30_000).toISOString(),
              scheduledAt: new Date(now - 10 * 60_000).toISOString(),
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('deferred-gap')!;
    const attemptId = lead.messageJobIdsByKey.get('attempt-1')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    await seedThrottleRow(harness, {
      mailboxId,
      sentCount: 0,
      dailyLimit: 50,
      hourlyLimit: 50,
      minGapSeconds: 3600,
      lastSentAt,
    });

    const throttleResult = await harness.supabase
      .rpc('check_mailbox_throttle_and_reserve', {
        p_message_job_id: attemptId,
      })
      .single();
    assert.equal(throttleResult.error, null);
    assert.equal(throttleResult.data?.success, false);
    assert.equal(throttleResult.data?.failure_reason, 'Minimum gap between sends not met');

    const { data: deferredAttempt, error: deferredAttemptError } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason')
      .eq('id', attemptId)
      .single();
    assert.equal(deferredAttemptError, null);
    assert.equal(deferredAttempt?.status, 'deferred');
    assert.equal(deferredAttempt?.status_reason, 'min_gap_not_met');

    const { data: enrollmentRow, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('next_run_at')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollmentError, null);
    assert.ok(enrollmentRow?.next_run_at);
    assert.ok(Date.parse(enrollmentRow!.next_run_at) >= Date.parse(lastSentAt) + 3600_000);
  } finally {
    await harness.cleanup();
  }
});

test('batch interval assignment allows a fresh retry only after a deferred attempt and blocks all other existing statuses', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('throttle-dedupe') });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Throttle Dedupe Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      sendingIntervalSeconds: 3600,
      schedule: CHICAGO_SCHEDULE as any,
      mailboxes: [
        { key: 'mailbox-1', emailAddress: `${harness.namespace}-dedupe-1@furnace.test`, displayName: 'Throttle Dedupe Mailbox 1' },
        { key: 'mailbox-2', emailAddress: `${harness.namespace}-dedupe-2@furnace.test`, displayName: 'Throttle Dedupe Mailbox 2' },
        { key: 'mailbox-3', emailAddress: `${harness.namespace}-dedupe-3@furnace.test`, displayName: 'Throttle Dedupe Mailbox 3' },
        { key: 'mailbox-4', emailAddress: `${harness.namespace}-dedupe-4@furnace.test`, displayName: 'Throttle Dedupe Mailbox 4' },
        { key: 'mailbox-5', emailAddress: `${harness.namespace}-dedupe-5@furnace.test`, displayName: 'Throttle Dedupe Mailbox 5' },
        { key: 'mailbox-6', emailAddress: `${harness.namespace}-dedupe-6@furnace.test`, displayName: 'Throttle Dedupe Mailbox 6' },
        { key: 'mailbox-7', emailAddress: `${harness.namespace}-dedupe-7@furnace.test`, displayName: 'Throttle Dedupe Mailbox 7' },
        { key: 'mailbox-8', emailAddress: `${harness.namespace}-dedupe-8@furnace.test`, displayName: 'Throttle Dedupe Mailbox 8' },
      ],
      leads: [
        buildCampaignLead({
          key: 'queued',
          email: `queued-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1', nextRunAt: new Date(now - 60_000).toISOString() }),
          jobs: [buildCampaignJob({ key: 'job', status: 'queued', nodeFlowNodeId: 'email-1' })],
        }),
        buildCampaignLead({
          key: 'reserved',
          email: `reserved-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-2',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1', nextRunAt: new Date(now - 60_000).toISOString() }),
          jobs: [buildCampaignJob({ key: 'job', status: 'reserved', nodeFlowNodeId: 'email-1', reservedAt: new Date(now - 30_000).toISOString() })],
        }),
        buildCampaignLead({
          key: 'sending',
          email: `sending-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-3',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1', nextRunAt: new Date(now - 60_000).toISOString() }),
          jobs: [buildCampaignJob({ key: 'job', status: 'sending', nodeFlowNodeId: 'email-1', reservedAt: new Date(now - 30_000).toISOString() })],
        }),
        buildCampaignLead({
          key: 'sent',
          email: `sent-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-4',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1', nextRunAt: new Date(now - 60_000).toISOString() }),
          jobs: [buildCampaignJob({ key: 'job', status: 'sent', statusReason: 'sent_successfully', nodeFlowNodeId: 'email-1', sentAt: new Date(now - 5 * 60_000).toISOString() })],
        }),
        buildCampaignLead({
          key: 'deferred',
          email: `deferred-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-5',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1', nextRunAt: new Date(now - 60_000).toISOString() }),
          jobs: [buildCampaignJob({ key: 'job', status: 'deferred', statusReason: 'daily_throttle_limit', nodeFlowNodeId: 'email-1' })],
        }),
        buildCampaignLead({
          key: 'failed',
          email: `failed-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-6',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1', nextRunAt: new Date(now - 60_000).toISOString() }),
          jobs: [buildCampaignJob({ key: 'job', status: 'failed', statusReason: 'provider_error', nodeFlowNodeId: 'email-1' })],
        }),
        buildCampaignLead({
          key: 'cancelled',
          email: `cancelled-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-7',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1', nextRunAt: new Date(now - 60_000).toISOString() }),
          jobs: [buildCampaignJob({ key: 'job', status: 'cancelled', statusReason: 'manually_cancelled', nodeFlowNodeId: 'email-1' })],
        }),
        buildCampaignLead({
          key: 'blocked',
          email: `blocked-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-8',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1', nextRunAt: new Date(now - 60_000).toISOString() }),
          jobs: [buildCampaignJob({ key: 'job', status: 'blocked', statusReason: 'lead_blocked', nodeFlowNodeId: 'email-1' })],
        }),
      ],
    });

    const intervalId = randomUUID();
    const { error: intervalError } = await harness.supabase.from('campaign_intervals').insert({
      id: intervalId,
      campaign_id: graph.campaignId,
      account_id: graph.accountId,
      interval_time: new Date(now + 60 * 60_000).toISOString(),
      status: 'available',
    } as any);
    assert.equal(intervalError, null);

    const candidateJobData = Array.from(graph.leadsByKey.entries()).map(([leadKey, lead]) => ({
      enrollment_id: lead.enrollmentId,
      lead_id: lead.leadId,
      mailbox_id: graph.mailboxIdsByKey.get(`mailbox-${leadKey === 'queued' ? '1' : leadKey === 'reserved' ? '2' : leadKey === 'sending' ? '3' : leadKey === 'sent' ? '4' : leadKey === 'deferred' ? '5' : leadKey === 'failed' ? '6' : leadKey === 'cancelled' ? '7' : '8'}`),
      node_id: graph.nodeIdsByFlowNodeId.get('email-1'),
      message_data: {
        node_config: {},
        lead_data: { email: `${leadKey}-${harness.namespace}@furnace.test` },
      },
      jitter_percentage: 0,
    }));

    const assignResult = await harness.supabase.rpc('batch_assign_jobs_to_interval', {
      p_campaign_id: graph.campaignId,
      p_job_data: candidateJobData as any,
      p_worker_id: 'test-dedupe',
      p_required_mailbox_count: 8,
    });
    assert.equal(assignResult.error, null);

    for (const [leadKey, lead] of graph.leadsByKey.entries()) {
      const { data: jobs, error } = await harness.supabase
        .from('message_jobs')
        .select('id, status')
        .eq('enrollment_id', lead.enrollmentId!)
        .eq('node_id', graph.nodeIdsByFlowNodeId.get('email-1')!);
      assert.equal(error, null);

      if (leadKey === 'deferred') {
        assert.equal(jobs?.length, 2, `${leadKey} should get a fresh retry attempt`);
        assert.ok(jobs?.some((job: any) => job.status === 'queued'));
      } else {
        assert.equal(jobs?.length, 1, `${leadKey} should continue blocking new attempt creation`);
      }
    }
  } finally {
    await harness.cleanup();
  }
});
