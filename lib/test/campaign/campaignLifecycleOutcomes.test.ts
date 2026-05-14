import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Json } from '../../supabase/types/database';
import { CampaignDbHarness } from './harness';
import {
  buildProductionLikeSeedSpecs,
  DEV_DEFAULT_MAILBOX_COUNT,
  DEV_DEFAULT_TOTAL_LEADS,
} from './productionLikeSeed';
import { maintainCampaignIntervals } from '../../../workers/scheduler-worker/src/interval-management';
import { SchedulerWorker } from '../../../workers/scheduler-worker/src/worker';
import { DatabaseClient as SchedulerDatabaseClient } from '../../../workers/scheduler-worker/src/database';
import { SendWorker } from '../../../workers/send-worker/src/worker';
import { DatabaseClient as SendDatabaseClient } from '../../../workers/send-worker/src/database';
import { ThreadManager } from '../../../workers/inbox-checker-worker/src/thread-manager';
import type {
  Mailbox as InboxMailbox,
  ProcessedMessage,
} from '../../../workers/inbox-checker-worker/src/types';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

const CHICAGO_SCHEDULE = {
  timezone: 'America/Chicago',
  start_hour: 9,
  start_minute: 0,
  end_hour: 17,
  end_minute: 0,
  days_of_week: [1, 2, 3, 4, 5],
} as const;

class ScenarioClock {
  constructor(private nowMs: number) {}

  nowIso(): string {
    return new Date(this.nowMs).toISOString();
  }

  pastIso(ms: number): string {
    return new Date(this.nowMs - ms).toISOString();
  }

  futureIso(ms: number): string {
    return new Date(this.nowMs + ms).toISOString();
  }

  tick(ms: number): void {
    this.nowMs += ms;
  }
}

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

function createProcessedMessage(overrides: Partial<ProcessedMessage> = {}): ProcessedMessage {
  return {
    uid: 123,
    messageId: '<reply@example.com>',
    inReplyTo: '<abc@example.com>',
    references: null,
    from: { address: 'lead@example.com', name: 'Lead' },
    to: [{ address: 'porterg@furnaceoutbound.com', name: 'Porter' }],
    subject: 'Re: Hello',
    bodyText: 'Reply body',
    bodyHtml: '<p>Reply body</p>',
    date: new Date(),
    headers: {},
    attachments: [],
    ...overrides,
  };
}

async function loadLeadRows(harness: CampaignDbHarness, leadIds: string[]) {
  const { data, error } = await harness.supabase
    .from('leads')
    .select('id, email, mailbox_id, deleted_at')
    .in('id', leadIds);
  assert.equal(error, null);
  return new Map((data ?? []).map((row: any) => [row.id as string, row]));
}

async function loadEnrollmentRows(harness: CampaignDbHarness, enrollmentIds: string[]) {
  const { data, error } = await harness.supabase
    .from('enrollments')
    .select('id, campaign_id, lead_id, current_node_id, state, next_run_at, flow_position, created_at, updated_at')
    .in('id', enrollmentIds);
  assert.equal(error, null);
  return (data ?? []) as any[];
}

async function processEnrollmentIds(
  harness: CampaignDbHarness,
  worker: SchedulerWorker,
  enrollmentIds: string[],
) {
  const enrollments = await loadEnrollmentRows(harness, enrollmentIds);
  const grouped = (worker as any).groupEnrollmentsByCampaign(enrollments);
  const contexts = await (worker as any).loadCampaignContexts(grouped);
  for (const enrollment of enrollments) {
    await (worker as any).processEnrollment(enrollment, contexts.get(enrollment.campaign_id));
  }
}

async function assignJobsForLeadIds(
  harness: CampaignDbHarness,
  campaignId: string,
  leadIds: string[],
): Promise<void> {
  const leadRows = await loadLeadRows(harness, leadIds);
  const { data: campaignMailboxRows, error: campaignMailboxError } = await harness.supabase
    .from('campaign_mailboxes')
    .select('mailbox_id')
    .eq('campaign_id', campaignId)
    .order('mailbox_id', { ascending: true });
  assert.equal(campaignMailboxError, null);
  const campaignMailboxIds = (campaignMailboxRows ?? []).map((row: any) => row.mailbox_id as string);
  const { data: enrollmentRows, error: enrollmentError } = await harness.supabase
    .from('enrollments')
    .select('id, lead_id, current_node_id')
    .eq('campaign_id', campaignId)
    .in('lead_id', leadIds);
  assert.equal(enrollmentError, null);

  const jobData = (enrollmentRows ?? []).map((row: any, index: number) => {
    const lead = leadRows.get(row.lead_id);
    const mailboxId = lead?.mailbox_id ?? campaignMailboxIds[index % campaignMailboxIds.length];
    assert.ok(mailboxId, `expected mailbox resolution for lead ${row.lead_id}`);
    assert.ok(row.current_node_id, `expected current node for lead ${row.lead_id}`);
    return {
      enrollment_id: row.id,
      lead_id: row.lead_id,
      mailbox_id: mailboxId,
      node_id: row.current_node_id,
      message_data: {
        node_config: {},
        lead_data: { email: lead.email },
      },
      jitter_percentage: 0,
    };
  });

  const result = await harness.supabase.rpc('batch_assign_jobs_to_interval', {
    p_campaign_id: campaignId,
    p_job_data: jobData as any,
    p_worker_id: 'campaign-lifecycle-test',
    p_required_mailbox_count: DEV_DEFAULT_MAILBOX_COUNT,
  });
  assert.equal(result.error, null);
}

test('batch_assign_jobs_to_interval preserves variant assignment in queued campaign jobs', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('variant-assign') });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Variant Assignment Regression',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'first',
          email: `first-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
        }),
        buildCampaignLead({
          key: 'second',
          email: `second-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-2',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
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

    const nodeId = graph.nodeIdsByFlowNodeId.get('email-1');
    assert.ok(nodeId, 'expected synced email node');

    const { data: nodeRow, error: nodeError } = await harness.supabase
      .from('nodes')
      .select('node_data')
      .eq('id', nodeId)
      .single();
    assert.equal(nodeError, null);

    const expectedVariants = [...((((nodeRow as any)?.node_data?.variants ?? []) as Array<any>))]
      .sort((left, right) => (Number(left?.order ?? 999_999) - Number(right?.order ?? 999_999)))
      .map((variant) => ({
        id: String(variant.id),
        label: String(variant.label),
        subject: String(variant.subject ?? ''),
      }));
    assert.equal(expectedVariants.length, 2);

    const leadOrder = ['first', 'second'] as const;
    const leadIds = leadOrder.map((key) => graph.leadsByKey.get(key)!.leadId);
    const leadRows = await loadLeadRows(harness, leadIds);

    const jobData = leadOrder.map((key) => {
      const lead = graph.leadsByKey.get(key)!;
      const leadRow = leadRows.get(lead.leadId);
      assert.ok(leadRow, `expected lead row for ${key}`);
      const mailboxKey = key === 'first' ? 'mailbox-1' : 'mailbox-2';
      const mailboxId = graph.mailboxIdsByKey.get(mailboxKey);
      assert.ok(mailboxId, `expected mailbox ${mailboxKey}`);
      return {
        enrollment_id: lead.enrollmentId,
        lead_id: lead.leadId,
        mailbox_id: mailboxId,
        node_id: nodeId,
        message_data: {
          node_config: {},
          lead_data: { email: leadRow.email },
        },
        jitter_percentage: 0,
      };
    });

    const assignResult = await harness.supabase.rpc('batch_assign_jobs_to_interval', {
      p_campaign_id: graph.campaignId,
      p_job_data: jobData as any,
      p_worker_id: 'variant-assignment-test',
      p_required_mailbox_count: 2,
    });
    assert.equal(assignResult.error, null);
    assert.equal((assignResult.data as any)?.[0]?.jobs_created, 2);

    const { data: jobs, error: jobsError } = await harness.supabase
      .from('message_jobs')
      .select('lead_id, enrollment_id, status, message_type, variant_id, message_data')
      .eq('campaign_id', graph.campaignId)
      .eq('node_id', nodeId)
      .order('created_at', { ascending: true });
    assert.equal(jobsError, null);
    assert.equal(jobs?.length, 2);

    const jobsByLeadId = new Map((jobs ?? []).map((row: any) => [row.lead_id as string, row]));
    const orderedJobs = leadOrder.map((key) => {
      const lead = graph.leadsByKey.get(key);
      assert.ok(lead, `expected materialized lead for ${key}`);
      const job = jobsByLeadId.get(lead.leadId);
      assert.ok(job, `expected message job for ${key}`);
      return job as any;
    });

    orderedJobs.forEach((job, index) => {
      const expectedVariant = expectedVariants[index]!;
      assert.equal(job.status, 'queued');
      assert.equal(job.message_type, 'campaign');
      assert.equal(job.variant_id, expectedVariant.id);
      assert.equal(job.message_data?.variant?.id, expectedVariant.id);
      assert.equal(job.message_data?.variant?.label_snapshot, expectedVariant.label);
      assert.equal(job.message_data?.node_config?.subject, expectedVariant.subject);
      assert.ok(
        job.message_data?.node_config?.variants == null,
        'expected merged node_config without raw variants array',
      );
    });
  } finally {
    await harness.cleanup();
  }
});

async function loadLatestJobsForLeadIds(harness: CampaignDbHarness, leadIds: string[]) {
  const { data, error } = await harness.supabase
    .from('message_jobs')
    .select('*')
    .in('lead_id', leadIds)
    .order('created_at', { ascending: false });
  assert.equal(error, null);

  const latest = new Map<string, any>();
  for (const row of data ?? []) {
    if (!latest.has((row as any).lead_id)) {
      latest.set((row as any).lead_id, row);
    }
  }
  return latest;
}

async function reserveJobs(harness: CampaignDbHarness, jobIds: string[], clock: ScenarioClock) {
  const reserved = new Map<string, any>();
  for (const jobId of jobIds) {
    const { data, error } = await harness.supabase
      .from('message_jobs')
      .update({
        status: 'reserved',
        status_reason: null,
        reserved_at: clock.nowIso(),
        updated_at: clock.nowIso(),
      } as any)
      .eq('id', jobId)
      .select('*')
      .single();
    assert.equal(error, null);
    reserved.set(jobId, data);
  }
  return reserved;
}

async function getMailbox(harness: CampaignDbHarness, mailboxId: string): Promise<InboxMailbox> {
  const { data, error } = await harness.supabase.from('mailboxes').select('*').eq('id', mailboxId).single();
  assert.equal(error, null);
  return data as InboxMailbox;
}

async function insertMidRunLeads(
  harness: CampaignDbHarness,
  params: {
    campaignId: string;
    accountId: string;
    bucketId: string;
    mailboxIds: string[];
    clock: ScenarioClock;
    count: number;
    namespace: string;
  },
) {
  const leadIds: string[] = [];
  const enrollmentIds: string[] = [];

  for (let i = 0; i < params.count; i += 1) {
    const leadId = randomUUID();
    const enrollmentId = randomUUID();
    const mailboxId = params.mailboxIds[i % params.mailboxIds.length]!;
    leadIds.push(leadId);
    enrollmentIds.push(enrollmentId);

    const { error: leadError } = await harness.supabase.from('leads').insert({
      id: leadId,
      campaign_id: params.campaignId,
      bucket_id: params.bucketId,
      account_id: params.accountId,
      email: `${params.namespace}-midrun-${String(i + 1).padStart(2, '0')}@furnace.test`,
      name: `Mid Run ${i + 1}`,
      first_name: 'Mid',
      last_name: `Run${i + 1}`,
      company_name: 'Mid Run Co',
      source: params.namespace,
      mailbox_id: mailboxId,
      status: 'new',
    } as any);
    assert.equal(leadError, null);

    const { error: enrollmentError } = await harness.supabase.from('enrollments').insert({
      id: enrollmentId,
      campaign_id: params.campaignId,
      account_id: params.accountId,
      lead_id: leadId,
      current_node_id: null,
      state: 'active',
      next_run_at: params.clock.pastIso(60_000),
      flow_position: {},
      created_at: params.clock.nowIso(),
      updated_at: params.clock.nowIso(),
    } as any);
    assert.equal(enrollmentError, null);
  }

  return { leadIds, enrollmentIds };
}

test('production-like campaign lifecycle stays internally consistent across mixed scheduler and worker outcomes at scale', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('campaign-lifecycle'),
  });
  const clock = new ScenarioClock(Date.now());
  const prodSpecs = buildProductionLikeSeedSpecs();
  const mergedLeadSpecs = prodSpecs.flatMap((spec) => spec.leads);
  const mergedReplacementSpecs = prodSpecs.flatMap((spec) => spec.replacements ?? []);

  const schedulerWorker = new SchedulerWorker({
    supabase: harness.supabase as any,
    databaseClient: new SchedulerDatabaseClient({
      supabase: harness.supabase as any,
      batchSize: 500,
      pollIntervalMs: 1000,
    }) as any,
  });

  const failingJobIds = new Set<string>();
  const sendWorker = new SendWorker({
    supabase: harness.supabase as any,
    databaseClient: new SendDatabaseClient({
      supabase: harness.supabase as any,
      batchSize: 100,
      pollIntervalMs: 1000,
    }) as any,
    campaignEmailSender: async (_transporter, _mailbox, job) => {
      if (failingJobIds.has(job.id)) {
        throw new Error('Synthetic provider failure');
      }
      return `<${job.id}@furnace.test>`;
    },
  });
  (sendWorker as any).smtpPool = {
    getTransporter: async () => ({}),
    closeAll: async () => {},
  };
  const threadManager = new ThreadManager(harness.supabase as any);

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Campaign Lifecycle Outcomes',
      status: 'running',
      flowKind: 'emailWaitEmail',
      sendingIntervalSeconds: 3600,
      schedule: CHICAGO_SCHEDULE as unknown as Json,
      mailboxes: prodSpecs[0]!.mailboxes,
      leads: mergedLeadSpecs,
      replacements: mergedReplacementSpecs,
    });

    assert.equal(graph.leadsByKey.size, DEV_DEFAULT_TOTAL_LEADS);
    assert.equal(graph.mailboxIdsByKey.size, DEV_DEFAULT_MAILBOX_COUNT);

    await maintainCampaignIntervals(harness.supabase as any);

    const { data: initialIntervals, error: initialIntervalsError } = await harness.supabase
      .from('campaign_intervals')
      .select('id, interval_time')
      .eq('campaign_id', graph.campaignId)
      .order('interval_time', { ascending: true })
      .limit(5);
    assert.equal(initialIntervalsError, null);
    assert.ok((initialIntervals ?? []).length > 0);
    for (const interval of initialIntervals ?? []) {
      assertInChicagoBusinessHours((interval as any).interval_time);
    }

    const outcomeLeadKeys = [
      'running-primary-lead-261',
      'running-primary-lead-262',
      'running-primary-lead-263',
      'running-primary-lead-264',
      'running-primary-lead-265',
      'running-primary-lead-266',
      'running-primary-lead-267',
      'running-primary-lead-268',
      'running-primary-lead-269',
    ];
    const outcomeLeadIds = outcomeLeadKeys.map((key) => graph.leadsByKey.get(key)!.leadId);
    const outcomeEnrollmentIds = outcomeLeadKeys.map((key) => graph.leadsByKey.get(key)!.enrollmentId!);

    await processEnrollmentIds(harness, schedulerWorker, outcomeEnrollmentIds);
    await assignJobsForLeadIds(harness, graph.campaignId, outcomeLeadIds);

    const latestAssignedJobs = await loadLatestJobsForLeadIds(harness, outcomeLeadIds);
    const createdJobIds = outcomeLeadIds.map((leadId) => latestAssignedJobs.get(leadId)?.id as string);

    const throttleBypassJobIds = [
      latestAssignedJobs.get(graph.leadsByKey.get('running-primary-lead-261')!.leadId)?.id,
      latestAssignedJobs.get(graph.leadsByKey.get('running-primary-lead-262')!.leadId)?.id,
      latestAssignedJobs.get(graph.leadsByKey.get('running-primary-lead-266')!.leadId)?.id,
    ].filter((jobId): jobId is string => Boolean(jobId));
    const { error: throttleBypassError } = await harness.supabase
      .from('message_jobs')
      .update({
        throttle_bypass_next_attempt: true,
        updated_at: clock.nowIso(),
      } as any)
      .in('id', throttleBypassJobIds);
    assert.equal(throttleBypassError, null);

    const reservedJobs = await reserveJobs(harness, createdJobIds.slice(0, 8), clock);

    const leadRows = await loadLeadRows(harness, outcomeLeadIds);
    const { error: clearBlockListError } = await harness.supabase
      .from('block_list')
      .delete()
      .eq('account_id', graph.accountId)
      .in(
        'value',
        Array.from(leadRows.values())
          .map((row: any) => row.email as string)
          .filter(Boolean),
      );
    assert.equal(clearBlockListError, null);

    const deferredLead = graph.leadsByKey.get('running-primary-lead-263')!;
    const deferredJob = latestAssignedJobs.get(deferredLead.leadId);
    assert.ok(deferredJob?.mailbox_id);
    const { error: throttleSeedError } = await harness.supabase.from('mailbox_throttles').upsert({
      mailbox_id: deferredJob!.mailbox_id,
      account_id: graph.accountId,
      date: clock.nowIso().slice(0, 10),
      sent_count: 1,
      hourly_sent: { [new Date().getUTCHours()]: 1 },
      daily_limit: 1,
      hourly_limit: 50,
      min_gap_seconds: 60,
      last_sent_at: clock.pastIso(5 * 60_000),
      updated_at: clock.nowIso(),
    } as any, {
      onConflict: 'mailbox_id,date',
    });
    assert.equal(throttleSeedError, null);

    const blockedLead = graph.leadsByKey.get('running-primary-lead-264')!;
    const blockedLeadRow = leadRows.get(blockedLead.leadId)!;
    const { error: blockError } = await harness.supabase.from('block_list').upsert({
      account_id: graph.accountId,
      value: blockedLeadRow.email,
      type: 'email',
      reason: 'test-block',
    } as any, {
      onConflict: 'account_id,value,type',
      ignoreDuplicates: true,
    });
    assert.equal(blockError, null);

    const cancelledLead = graph.leadsByKey.get('running-primary-lead-265')!;
    const { error: deleteLeadError } = await harness.supabase
      .from('leads')
      .update({ deleted_at: clock.nowIso(), updated_at: clock.nowIso() } as any)
      .eq('id', cancelledLead.leadId);
    assert.equal(deleteLeadError, null);

    const failedLead = graph.leadsByKey.get('running-primary-lead-266')!;
    failingJobIds.add(latestAssignedJobs.get(failedLead.leadId)!.id);
    const failedJob = latestAssignedJobs.get(failedLead.leadId)!;
    assert.ok(failedJob?.mailbox_id);
    const { error: failedMailboxError } = await harness.supabase
      .from('mailboxes')
      .update({
        email_address: `failure-${failedLead.leadId.slice(0, 8)}@example.com`,
        updated_at: clock.nowIso(),
      } as any)
      .eq('id', failedJob.mailbox_id);
    assert.equal(failedMailboxError, null);

    for (const leadKey of outcomeLeadKeys.slice(0, 6)) {
      const lead = graph.leadsByKey.get(leadKey)!;
      const job = reservedJobs.get(latestAssignedJobs.get(lead.leadId)!.id);
      try {
        await (sendWorker as any).processMessageJob(job);
      } catch (error) {
        assert.equal(leadKey, 'running-primary-lead-266');
        assert.match(String(error), /Synthetic provider failure/);
      }
      clock.tick(1_000);
    }

    const latestOutcomeJobs = await loadLatestJobsForLeadIds(harness, outcomeLeadIds);
    assert.equal(latestOutcomeJobs.get(graph.leadsByKey.get('running-primary-lead-261')!.leadId)?.status, 'sent');
    assert.equal(latestOutcomeJobs.get(graph.leadsByKey.get('running-primary-lead-262')!.leadId)?.status, 'sent');
    assert.equal(latestOutcomeJobs.get(graph.leadsByKey.get('running-primary-lead-263')!.leadId)?.status, 'deferred');
    assert.equal(latestOutcomeJobs.get(graph.leadsByKey.get('running-primary-lead-263')!.leadId)?.status_reason, 'daily_throttle_limit');
    assert.equal(latestOutcomeJobs.get(graph.leadsByKey.get('running-primary-lead-264')!.leadId)?.status, 'blocked');
    assert.equal(latestOutcomeJobs.get(graph.leadsByKey.get('running-primary-lead-265')!.leadId)?.status, 'cancelled');
    assert.equal(latestOutcomeJobs.get(graph.leadsByKey.get('running-primary-lead-266')!.leadId)?.status, 'failed');

    const sentLeadOne = graph.leadsByKey.get('running-primary-lead-261')!;
    const sentLeadTwo = graph.leadsByKey.get('running-primary-lead-262')!;
    const sentJobOne = latestOutcomeJobs.get(sentLeadOne.leadId)!;
    const sentJobTwo = latestOutcomeJobs.get(sentLeadTwo.leadId)!;
    const sentLeadRows = await loadLeadRows(harness, [sentLeadOne.leadId, sentLeadTwo.leadId]);
    const mailboxOne = await getMailbox(harness, sentJobOne.mailbox_id);
    const mailboxTwo = await getMailbox(harness, sentJobTwo.mailbox_id);

    const replyHandled = await threadManager.handleReply(
      mailboxOne,
      createProcessedMessage({
        messageId: `<reply-${randomUUID()}@furnace.test>`,
        inReplyTo: sentJobOne.provider_message_id,
        references: sentJobOne.provider_message_id,
        from: { address: sentLeadRows.get(sentLeadOne.leadId)!.email, name: 'Reply Lead' },
        to: [{ address: mailboxOne.email_address, name: mailboxOne.display_name ?? 'Box' }],
        subject: 'Re: Campaign follow-up',
        bodyText: 'Interested - please send details.',
        bodyHtml: '<p>Interested - please send details.</p>',
      }),
    );
    assert.equal(replyHandled, true);

    await threadManager.handleBounce(
      mailboxTwo,
      createProcessedMessage({
        messageId: `<bounce-${randomUUID()}@furnace.test>`,
        from: { address: 'mailer-daemon@example.com', name: 'Mailer Daemon' },
        to: [{ address: mailboxTwo.email_address, name: mailboxTwo.display_name ?? 'Box' }],
        subject: 'Delivery Status Notification (Failure)',
        bodyText: `550 5.1.1 User unknown ${sentLeadRows.get(sentLeadTwo.leadId)!.email}`,
        bodyHtml: null,
        inReplyTo: null,
        references: null,
      }),
    );

    const { data: postInboxEnrollments, error: postInboxError } = await harness.supabase
      .from('enrollments')
      .select('id, state, stopped_reason')
      .in('id', [sentLeadOne.enrollmentId!, sentLeadTwo.enrollmentId!]);
    assert.equal(postInboxError, null);
    const postInboxById = new Map((postInboxEnrollments ?? []).map((row: any) => [row.id, row]));
    assert.equal(postInboxById.get(sentLeadOne.enrollmentId!)?.stopped_reason, 'replied');
    assert.equal(postInboxById.get(sentLeadTwo.enrollmentId!)?.stopped_reason, 'bounced');

    const pauseQueuedLead = graph.leadsByKey.get('running-primary-lead-267')!;
    const pauseReservedLead = graph.leadsByKey.get('running-primary-lead-268')!;
    const pauseSendingLead = graph.leadsByKey.get('running-primary-lead-269')!;
    const pauseReservedJob = latestAssignedJobs.get(pauseReservedLead.leadId)!;
    const pauseSendingJob = latestAssignedJobs.get(pauseSendingLead.leadId)!;
    const throttleDeferredBeforePause = latestOutcomeJobs.get(deferredLead.leadId)!;

    const { error: pauseReservedError } = await harness.supabase
      .from('message_jobs')
      .update({ status: 'reserved', reserved_at: clock.nowIso(), updated_at: clock.nowIso() } as any)
      .eq('id', pauseReservedJob.id);
    assert.equal(pauseReservedError, null);
    const { error: pauseSendingError } = await harness.supabase
      .from('message_jobs')
      .update({ status: 'sending', reserved_at: clock.nowIso(), updated_at: clock.nowIso() } as any)
      .eq('id', pauseSendingJob.id);
    assert.equal(pauseSendingError, null);

    const pauseResult = await harness.supabase.rpc('pause_campaign_and_defer_jobs', {
      p_campaign_id: graph.campaignId,
    });
    assert.equal(pauseResult.error, null);

    const { data: pauseRows, error: pauseRowsError } = await harness.supabase
      .from('message_jobs')
      .select('id, status, status_reason')
      .in('id', [
        latestAssignedJobs.get(pauseQueuedLead.leadId)!.id,
        pauseReservedJob.id,
        pauseSendingJob.id,
        throttleDeferredBeforePause.id,
      ]);
    assert.equal(pauseRowsError, null);
    const pauseRowsById = new Map((pauseRows ?? []).map((row: any) => [row.id, row]));
    assert.equal(pauseRowsById.get(latestAssignedJobs.get(pauseQueuedLead.leadId)!.id)?.status, 'deferred');
    assert.equal(pauseRowsById.get(latestAssignedJobs.get(pauseQueuedLead.leadId)!.id)?.status_reason, 'campaign_paused');
    assert.equal(pauseRowsById.get(pauseReservedJob.id)?.status, 'deferred');
    assert.equal(pauseRowsById.get(pauseReservedJob.id)?.status_reason, 'campaign_paused');
    assert.equal(pauseRowsById.get(pauseSendingJob.id)?.status, 'sending');
    assert.equal(pauseRowsById.get(throttleDeferredBeforePause.id)?.status_reason, 'daily_throttle_limit');

    const resumeResult = await harness.supabase.rpc('resume_campaign_and_reschedule_jobs', {
      p_campaign_id: graph.campaignId,
      p_pause_reason: 'Campaign paused',
    });
    assert.equal(resumeResult.error, null);

    const { data: resumedEnrollments, error: resumedEnrollmentError } = await harness.supabase
      .from('enrollments')
      .select('id, next_run_at')
      .in('id', [pauseQueuedLead.enrollmentId!, pauseReservedLead.enrollmentId!, deferredLead.enrollmentId!]);
    assert.equal(resumedEnrollmentError, null);
    const resumedById = new Map((resumedEnrollments ?? []).map((row: any) => [row.id, row]));
    assert.ok(resumedById.get(pauseQueuedLead.enrollmentId!)?.next_run_at);
    assert.ok(resumedById.get(pauseReservedLead.enrollmentId!)?.next_run_at);
    assert.ok(resumedById.get(deferredLead.enrollmentId!)?.next_run_at);

    const midRun = await insertMidRunLeads(harness, {
      campaignId: graph.campaignId,
      accountId: graph.accountId,
      bucketId: graph.bucketId,
      mailboxIds: Array.from(graph.mailboxIdsByKey.values()),
      clock,
      count: 10,
      namespace: harness.namespace,
    });
    await processEnrollmentIds(harness, schedulerWorker, midRun.enrollmentIds);
    await assignJobsForLeadIds(harness, graph.campaignId, midRun.leadIds);
    const midRunJobs = await loadLatestJobsForLeadIds(harness, midRun.leadIds);
    assert.equal(midRunJobs.size, midRun.leadIds.length);

    const oooDue = graph.leadsByKey.get('primary-ooo-due')!;
    const oooFuture = graph.leadsByKey.get('primary-ooo-future')!;
    const oooResult = await harness.supabase.rpc('process_due_out_of_office_resumes', {
      p_batch_size: 250,
    });
    assert.equal(oooResult.error, null);
    assert.ok(typeof oooResult.data === 'number' && oooResult.data >= 1);

    const { data: oooEnrollments, error: oooEnrollmentError } = await harness.supabase
      .from('enrollments')
      .select('id, state, next_run_at, stopped_reason')
      .in('id', [oooDue.enrollmentId!, oooFuture.enrollmentId!]);
    assert.equal(oooEnrollmentError, null);
    const oooById = new Map((oooEnrollments ?? []).map((row: any) => [row.id, row]));
    assert.equal(oooById.get(oooDue.enrollmentId!)?.state, 'active');
    assert.ok(oooById.get(oooDue.enrollmentId!)?.next_run_at);
    assert.ok(oooById.has(oooFuture.enrollmentId!));

    const createdLifecycleJobIds = [
      ...createdJobIds,
      ...Array.from(midRunJobs.values()).map((row: any) => row.id as string),
    ];
    const { data: createdLifecycleJobs, error: createdLifecycleJobsError } = await harness.supabase
      .from('message_jobs')
      .select('id, status, status_reason, scheduled_at, interval_id, mailbox_id')
      .in('id', createdLifecycleJobIds);
    assert.equal(createdLifecycleJobsError, null);
    for (const job of createdLifecycleJobs ?? []) {
      if ((job as any).interval_id) {
        assertInChicagoBusinessHours((job as any).scheduled_at);
      }
    }

    const mailboxIntervalPairs = new Set<string>();
    for (const job of createdLifecycleJobs ?? []) {
      const intervalId = (job as any).interval_id;
      const mailboxId = (job as any).mailbox_id;
      if (!intervalId || !mailboxId) {
        continue;
      }
      const key = `${intervalId}:${mailboxId}`;
      assert.ok(!mailboxIntervalPairs.has(key), `expected one job per mailbox per interval, duplicate ${key}`);
      mailboxIntervalPairs.add(key);
    }
  } finally {
    await harness.cleanup();
  }
});
