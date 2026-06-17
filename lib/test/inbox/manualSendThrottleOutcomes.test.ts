import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { CampaignDbHarness } from '../campaign/harness';
import { ClientApiDbHarness } from '../client-api/harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from '../campaign/fixtures';

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

async function createReservedJobGraph(
  harness: CampaignDbHarness,
  params: {
    name: string;
    jobKey: string;
    leadKey: string;
    emailLocal: string;
    messageType: 'campaign' | 'campaign_reply' | 'inbox_reply';
  },
) {
  const now = Date.now();
  return harness.createCampaignGraph({
    name: params.name,
    status: 'running',
    flowKind: 'emailOnly',
    leads: [
      buildCampaignLead({
        key: params.leadKey,
        email: `${params.emailLocal}-${harness.namespace}@furnace.test`,
        mailboxKey: 'mailbox-1',
        enrollment: buildCampaignEnrollment({
          state: 'active',
          currentFlowNodeId: 'email-1',
          nextRunAt: new Date(now - 60_000).toISOString(),
        }),
        jobs: [
          buildCampaignJob({
            key: params.jobKey,
            nodeFlowNodeId: params.messageType === 'inbox_reply' ? null : 'email-1',
            status: 'reserved',
            reservedAt: new Date(now - 30_000).toISOString(),
            leaseExpiresAt: new Date(now + 5 * 60_000).toISOString(),
            messageType: params.messageType,
            messageData: { source: params.messageType },
          }),
        ],
      }),
    ],
  });
}

test('inbox_reply skips the daily throttle wait', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('manual-daily') });

  try {
    const graph = await createReservedJobGraph(harness, {
      name: 'Manual Reply Daily Exemption',
      jobKey: 'manual-reply',
      leadKey: 'manual-reply',
      emailLocal: 'manual-reply',
      messageType: 'inbox_reply',
    });

    const lead = graph.leadsByKey.get('manual-reply')!;
    const jobId = lead.messageJobIdsByKey.get('manual-reply')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    await seedThrottleRow(harness, {
      mailboxId,
      sentCount: 1,
      dailyLimit: 1,
      hourlyLimit: 50,
      minGapSeconds: 60,
      lastSentAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });

    const throttleResult = await harness.supabase
      .rpc('check_mailbox_throttle_and_reserve', { p_message_job_id: jobId })
      .single();

    assert.equal(throttleResult.error, null);
    assert.equal(throttleResult.data?.success, true);

    const { data: jobRow, error: jobError } = await harness.supabase
      .from('message_jobs')
      .select('status, send_wait_reason')
      .eq('id', jobId)
      .single();
    assert.equal(jobError, null);
    assert.equal(jobRow?.status, 'reserved');
    assert.equal(jobRow?.send_wait_reason, null);
  } finally {
    await harness.cleanup();
  }
});

test('campaign_reply also skips the daily throttle wait', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('reply-lane-daily') });

  try {
    const graph = await createReservedJobGraph(harness, {
      name: 'Campaign Reply Daily Exemption',
      jobKey: 'campaign-reply',
      leadKey: 'campaign-reply',
      emailLocal: 'campaign-reply',
      messageType: 'campaign_reply',
    });

    const lead = graph.leadsByKey.get('campaign-reply')!;
    const jobId = lead.messageJobIdsByKey.get('campaign-reply')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    await seedThrottleRow(harness, {
      mailboxId,
      sentCount: 1,
      dailyLimit: 1,
      hourlyLimit: 50,
      minGapSeconds: 60,
      lastSentAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });

    const throttleResult = await harness.supabase
      .rpc('check_mailbox_throttle_and_reserve', { p_message_job_id: jobId })
      .single();

    assert.equal(throttleResult.error, null);
    assert.equal(throttleResult.data?.success, true);

    const { data: jobRow, error: jobError } = await harness.supabase
      .from('message_jobs')
      .select('status, send_wait_reason')
      .eq('id', jobId)
      .single();
    assert.equal(jobError, null);
    assert.equal(jobRow?.status, 'reserved');
    assert.equal(jobRow?.send_wait_reason, null);
  } finally {
    await harness.cleanup();
  }
});

test('dedicated campaign sends still defer at the daily cap', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('campaign-daily') });

  try {
    const graph = await createReservedJobGraph(harness, {
      name: 'Campaign Daily Throttle Guard',
      jobKey: 'campaign-send',
      leadKey: 'campaign-send',
      emailLocal: 'campaign-send',
      messageType: 'campaign',
    });

    const lead = graph.leadsByKey.get('campaign-send')!;
    const jobId = lead.messageJobIdsByKey.get('campaign-send')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    await seedThrottleRow(harness, {
      mailboxId,
      sentCount: 1,
      dailyLimit: 1,
      hourlyLimit: 50,
      minGapSeconds: 60,
      lastSentAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });

    const throttleResult = await harness.supabase
      .rpc('check_mailbox_throttle_and_reserve', { p_message_job_id: jobId })
      .single();

    assert.equal(throttleResult.error, null);
    assert.equal(throttleResult.data?.success, false);
    assert.equal(throttleResult.data?.failure_reason, 'Daily throttle limit exceeded');

    const { data: jobRow, error: jobError } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason, send_wait_reason')
      .eq('id', jobId)
      .single();
    assert.equal(jobError, null);
    assert.equal(jobRow?.status, 'deferred');
    assert.equal(jobRow?.status_reason, 'daily_throttle_limit');
    assert.equal(jobRow?.send_wait_reason, 'Daily send limit reached for this mailbox');
  } finally {
    await harness.cleanup();
  }
});

test('inbox_reply still queues on hourly throttle', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('manual-hourly') });

  try {
    const graph = await createReservedJobGraph(harness, {
      name: 'Manual Reply Hourly Throttle',
      jobKey: 'manual-hourly',
      leadKey: 'manual-hourly',
      emailLocal: 'manual-hourly',
      messageType: 'inbox_reply',
    });

    const lead = graph.leadsByKey.get('manual-hourly')!;
    const jobId = lead.messageJobIdsByKey.get('manual-hourly')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const hourKey = String(new Date().getUTCHours());

    await seedThrottleRow(harness, {
      mailboxId,
      sentCount: 0,
      hourlySent: { [hourKey]: 1 },
      dailyLimit: 50,
      hourlyLimit: 1,
      minGapSeconds: 60,
      lastSentAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });

    const throttleResult = await harness.supabase
      .rpc('check_mailbox_throttle_and_reserve', { p_message_job_id: jobId })
      .single();

    assert.equal(throttleResult.error, null);
    assert.equal(throttleResult.data?.success, false);
    assert.equal(throttleResult.data?.failure_reason, 'Hourly throttle limit exceeded');

    const { data: jobRow, error: jobError } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason, send_wait_reason, scheduled_at')
      .eq('id', jobId)
      .single();
    assert.equal(jobError, null);
    assert.equal(jobRow?.status, 'queued');
    assert.equal(jobRow?.status_reason, null);
    assert.equal(jobRow?.send_wait_reason, 'Hourly send limit reached for this mailbox');
    assert.ok(jobRow?.scheduled_at, 'expected a retry time for hourly throttled inbox reply');
  } finally {
    await harness.cleanup();
  }
});

test('finalize_message_job_sent increments daily counters for reply-lane sends', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('reply-lane-finalize') });
  const sentAt = new Date().toISOString();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Reply Lane Finalize Accounting',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'reply-lane-finalize',
          email: `reply-lane-finalize-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'reply-lane-finalize',
              nodeFlowNodeId: null,
              status: 'sending',
              sendingStartedAt: sentAt,
              messageType: 'inbox_reply',
              messageData: { source: 'inbox_reply' },
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('reply-lane-finalize')!;
    const jobId = lead.messageJobIdsByKey.get('reply-lane-finalize')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    const finalizeResult = await harness.supabase.rpc('finalize_message_job_sent', {
      p_message_job_id: jobId,
      p_provider_message_id: 'provider-message-id-reply-lane',
      p_sent_at: sentAt,
    });
    assert.equal(finalizeResult.error, null);
    assert.equal(finalizeResult.data, true);

    const { data: throttleRow, error: throttleError } = await harness.supabase
      .from('mailbox_throttles')
      .select('sent_count, last_sent_at')
      .eq('mailbox_id', mailboxId)
      .eq('date', sentAt.slice(0, 10))
      .single();
    assert.equal(throttleError, null);
    assert.equal(throttleRow?.sent_count, 1);
    assert.equal(Date.parse(throttleRow!.last_sent_at), Date.parse(sentAt));
  } finally {
    await harness.cleanup();
  }
});

const publishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.SUPABASE_ANON_KEY?.trim();

test('request_immediate_manual_send accepts queued inbox jobs', { skip: !publishableKey }, async () => {
  const harness = new ClientApiDbHarness({ namespace: createCampaignTestNamespace('manual-send-now') });

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Manual Send Now RPC',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'manual-send-now',
          email: `manual-send-now-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'manual-send-now',
              nodeFlowNodeId: null,
              status: 'queued',
              scheduledAt: new Date(Date.now() + 60_000).toISOString(),
              messageType: 'inbox_reply',
              messageData: { source: 'inbox_reply' },
              sendWaitReason: 'Hourly send limit reached for this mailbox',
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('manual-send-now')!;
    const jobId = lead.messageJobIdsByKey.get('manual-send-now')!;
    const ownerToken = await harness.getOwnerAccessToken();
    const ownerClient = createClient(harness.env.supabaseUrl, publishableKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${ownerToken}` } },
    });

    const rpcResult = await ownerClient.rpc('request_immediate_manual_send', {
      p_message_job_id: jobId,
    });
    assert.equal(rpcResult.error, null);
    assert.equal(rpcResult.data, true);

    const { data: jobRow, error: jobError } = await harness.supabase
      .from('message_jobs')
      .select('status, send_wait_reason, throttle_bypass_next_attempt, scheduled_at')
      .eq('id', jobId)
      .single();
    assert.equal(jobError, null);
    assert.equal(jobRow?.status, 'queued');
    assert.equal(jobRow?.send_wait_reason, null);
    assert.equal(jobRow?.throttle_bypass_next_attempt, true);
    assert.ok(jobRow?.scheduled_at, 'expected send-now RPC to keep a scheduled_at timestamp');
    assert.ok(Date.parse(jobRow!.scheduled_at) <= Date.now() + 5_000, 'expected queued job to be runnable immediately');
  } finally {
    await harness.cleanup();
  }
});
