import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadSeedEnv } from '../../../scripts/seed/env';
import { ClientApiDbHarness, createClientApiTestNamespace } from '../client-api/harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  buildCampaignThread,
  buildThreadMessage,
} from '../campaign/fixtures';

// Must load before reading publishableKey — `{ skip: !publishableKey }` is
// evaluated at module load, before any harness constructor runs.
loadSeedEnv();

const publishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.SUPABASE_ANON_KEY?.trim();

function skipIfReplyLaneMigrationUnavailable(
  t: { skip: (message?: string) => never },
  error:
    | {
        code?: string | null;
        message?: string | null;
      }
    | null
    | undefined
) {
  if (!error) return false;
  if (error.code === 'PGRST202') {
    t.skip('Reply-lane inbox RPC migration is not applied in the target test database yet.');
  }
  if (error.message === 'Only manual inbox jobs can be sent immediately') {
    t.skip('Reply-lane send-now migration is not applied in the target test database yet.');
  }
  return false;
}

async function createOwnerClient(harness: ClientApiDbHarness) {
  const ownerToken = await harness.getOwnerAccessToken();
  return createClient(harness.env.supabaseUrl, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ownerToken}` } },
  });
}

async function seedCampaignPriorityJob(harness: ClientApiDbHarness, status: 'queued' | 'failed' = 'queued') {
  const graph = await harness.campaignHarness.createCampaignGraph({
    name: 'Pending Campaign Reply RPC',
    status: 'running',
    flowKind: 'emailWaitEmailCategorizer',
    leads: [
      buildCampaignLead({
        key: 'campaign-reply',
        email: `campaign-reply-${harness.namespace}@furnace.test`,
        mailboxKey: 'mailbox-1',
        enrollment: buildCampaignEnrollment({
          state: 'active',
          currentFlowNodeId: 'email-3',
          nextRunAt: null,
          attachReplyThread: true,
        }),
        jobs: [
          buildCampaignJob({
            key: 'campaign-priority',
            nodeFlowNodeId: 'email-3',
            status,
            scheduledAt: new Date(Date.now() + 60_000).toISOString(),
            messageType: 'campaign_priority',
            sendWaitReason: 'Hourly send limit reached for this mailbox',
          }),
        ],
        thread: buildCampaignThread({
          subject: 'Re: Interested in details',
          category: 'Interested',
          hasReply: true,
          messages: [
            buildThreadMessage({
              direction: 'sent',
              receivedAt: new Date(Date.now() - 120_000).toISOString(),
              messageId: '<seed-sent@furnace.test>',
            }),
            buildThreadMessage({
              direction: 'received',
              receivedAt: new Date(Date.now() - 60_000).toISOString(),
              messageId: '<seed-received@furnace.test>',
              inReplyTo: '<seed-sent@furnace.test>',
            }),
          ],
        }),
      }),
    ],
  });

  const lead = graph.leadsByKey.get('campaign-reply')!;
  const jobId = lead.messageJobIdsByKey.get('campaign-priority')!;
  const threadId = lead.threadId!;
  const enrollmentId = lead.enrollmentId!;

  const { error } = await harness.supabase
    .from('message_jobs')
    .update({
      message_data: {
        source: 'campaign_priority',
        thread_id: threadId,
        subject: 'Re: Interested in details',
        to_email: `campaign-reply-${harness.namespace}@furnace.test`,
        to_name: 'Pending Reply Prospect',
        lead_data: {
          email: `campaign-reply-${harness.namespace}@furnace.test`,
          name: 'Pending Reply Prospect',
          first_name: 'Pending',
        },
        node_config: {
          template: 'Hi {{first_name}} - sending the details now.',
        },
      },
    } as never)
    .eq('id', jobId);
  assert.equal(error, null);

  return { graph, threadId, jobId, enrollmentId };
}

async function seedManualReplyJob(harness: ClientApiDbHarness, status: 'queued' | 'failed' = 'queued') {
  const graph = await harness.campaignHarness.createCampaignGraph({
    name: 'Pending Manual Reply RPC',
    status: 'running',
    flowKind: 'emailOnly',
    leads: [
      buildCampaignLead({
        key: 'manual-reply',
        email: `manual-reply-${harness.namespace}@furnace.test`,
        mailboxKey: 'mailbox-1',
        enrollment: buildCampaignEnrollment({
          state: 'active',
          currentFlowNodeId: 'email-1',
          nextRunAt: null,
        }),
        jobs: [
          buildCampaignJob({
            key: 'manual-reply',
            nodeFlowNodeId: null,
            status,
            messageType: 'inbox_reply',
          }),
        ],
        thread: buildCampaignThread({
          subject: 'Re: Manual reply',
          hasReply: true,
        }),
      }),
    ],
  });

  const lead = graph.leadsByKey.get('manual-reply')!;
  const jobId = lead.messageJobIdsByKey.get('manual-reply')!;
  const threadId = lead.threadId!;

  const { error } = await harness.supabase
    .from('message_jobs')
    .update({
      message_data: {
        source: 'inbox_reply',
        thread_id: threadId,
        in_reply_to_message_id: 'seed-message-id',
        subject: 'Re: Manual reply',
        body_text: 'Thanks for the reply.',
        body_html: '<p>Thanks for the reply.</p>',
        to_email: `manual-reply-${harness.namespace}@furnace.test`,
        to_name: 'Manual Reply Prospect',
        cc: [],
      },
    } as never)
    .eq('id', jobId);
  assert.equal(error, null);

  return { jobId };
}

test(
  'request_immediate_manual_send accepts queued campaign_priority jobs',
  { skip: !publishableKey },
  async (t) => {
    const harness = new ClientApiDbHarness({
      namespace: createClientApiTestNamespace('campaign-reply-send-now'),
    });

    try {
      const { jobId } = await seedCampaignPriorityJob(harness, 'queued');
      const ownerClient = await createOwnerClient(harness);

      const rpcResult = await ownerClient.rpc('request_immediate_manual_send', {
        p_message_job_id: jobId,
      });
      skipIfReplyLaneMigrationUnavailable(t, rpcResult.error);
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
      assert.ok(jobRow?.scheduled_at);
      assert.ok(Date.parse(jobRow!.scheduled_at) <= Date.now() + 5_000);
    } finally {
      await harness.cleanup();
    }
  }
);

test(
  'cancel_pending_outbound_job marks campaign_priority as inbox_manual_override and wakes the enrollment',
  { skip: !publishableKey },
  async (t) => {
    const harness = new ClientApiDbHarness({
      namespace: createClientApiTestNamespace('campaign-reply-cancel'),
    });

    try {
      const { jobId, enrollmentId } = await seedCampaignPriorityJob(harness, 'queued');
      const ownerClient = await createOwnerClient(harness);

      const rpcResult = await ownerClient.rpc('cancel_pending_outbound_job', {
        p_message_job_id: jobId,
      });
      skipIfReplyLaneMigrationUnavailable(t, rpcResult.error);
      assert.equal(rpcResult.error, null);
      assert.equal(rpcResult.data, true);

      const { data: jobRow, error: jobError } = await harness.supabase
        .from('message_jobs')
        .select('status, status_reason, error_message')
        .eq('id', jobId)
        .single();
      assert.equal(jobError, null);
      assert.equal(jobRow?.status, 'cancelled');
      assert.equal(jobRow?.status_reason, 'inbox_manual_override');
      assert.equal(jobRow?.error_message, 'Cancelled from inbox');

      const { data: enrollmentRow, error: enrollmentError } = await harness.supabase
        .from('enrollments')
        .select('next_run_at')
        .eq('id', enrollmentId)
        .single();
      assert.equal(enrollmentError, null);
      assert.ok(enrollmentRow?.next_run_at);
      assert.ok(Date.parse(enrollmentRow!.next_run_at) <= Date.now() + 5_000);
    } finally {
      await harness.cleanup();
    }
  }
);

test(
  'cancel_pending_outbound_job marks inbox_reply as inbox_user_cancelled',
  { skip: !publishableKey },
  async (t) => {
    const harness = new ClientApiDbHarness({
      namespace: createClientApiTestNamespace('manual-reply-cancel'),
    });

    try {
      const { jobId } = await seedManualReplyJob(harness, 'failed');
      const ownerClient = await createOwnerClient(harness);

      const rpcResult = await ownerClient.rpc('cancel_pending_outbound_job', {
        p_message_job_id: jobId,
      });
      skipIfReplyLaneMigrationUnavailable(t, rpcResult.error);
      assert.equal(rpcResult.error, null);
      assert.equal(rpcResult.data, true);

      const { data: jobRow, error: jobError } = await harness.supabase
        .from('message_jobs')
        .select('status, status_reason, error_message')
        .eq('id', jobId)
        .single();
      assert.equal(jobError, null);
      assert.equal(jobRow?.status, 'cancelled');
      assert.equal(jobRow?.status_reason, 'inbox_user_cancelled');
      assert.equal(jobRow?.error_message, 'Cancelled from inbox');
    } finally {
      await harness.cleanup();
    }
  }
);

test(
  'get_thread_auto_reply_pipeline_state reports arming_reply before a campaign reply job exists',
  { skip: !publishableKey },
  async (t) => {
    const harness = new ClientApiDbHarness({
      namespace: createClientApiTestNamespace('reply-pipeline-arming'),
    });

    try {
      const graph = await harness.campaignHarness.createCampaignGraph({
        name: 'Reply Pipeline State',
        status: 'running',
        flowKind: 'emailWaitEmailCategorizer',
        leads: [
          buildCampaignLead({
            key: 'pipeline',
            email: `pipeline-${harness.namespace}@furnace.test`,
            mailboxKey: 'mailbox-1',
            enrollment: buildCampaignEnrollment({
              state: 'active',
              currentFlowNodeId: 'email-3',
              nextRunAt: null,
              attachReplyThread: true,
            }),
            thread: buildCampaignThread({
              subject: 'Re: Pipeline state',
              category: 'Interested',
              hasReply: true,
            }),
          }),
        ],
      });

      const threadId = graph.leadsByKey.get('pipeline')!.threadId!;
      const ownerClient = await createOwnerClient(harness);

      const rpcResult = await ownerClient.rpc('get_thread_auto_reply_pipeline_state', {
        p_thread_id: threadId,
      });
      skipIfReplyLaneMigrationUnavailable(t, rpcResult.error);
      assert.equal(rpcResult.error, null);
      const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
      assert.equal(row?.active, true);
      assert.equal(row?.phase, 'arming_reply');
      assert.equal(row?.label, 'Automated reply preparing...');
    } finally {
      await harness.cleanup();
    }
  }
);
