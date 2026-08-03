import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from '../campaign/harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from '../campaign/fixtures';
import { parseMessageIds } from '../../email/threadHeaders.js';

test('create_inbox_reply_job uses parent ancestry plus parent Message-ID', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('reply-job-refs'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Reply Job References Outcomes',
      status: 'running',
      flowKind: 'emailWaitEmail',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'reply-lead',
          email: `lead-reply-${harness.namespace}@example.com`,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('reply-lead')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    const leadEmail = `lead-reply-${harness.namespace}@example.com`;
    const mailboxEmail =
      graph.mailboxEmailsByKey.get('mailbox-1') ?? `sender-${harness.namespace}@example.com`;

    const { data: thread, error: threadError } = await harness.supabase
      .from('email_threads')
      .insert({
        account_id: graph.accountId,
        mailbox_id: mailboxId,
        campaign_id: graph.campaignId,
        lead_id: lead.leadId,
        enrollment_id: lead.enrollmentId,
        subject: 'Quick check-in',
        participants: [leadEmail],
        message_count: 1,
        has_reply: true,
        last_message_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    assert.equal(threadError, null);
    graph.manifest.threadIds.push(thread!.id);

    const { data: parent, error: parentError } = await harness.supabase
      .from('email_messages')
      .insert({
        thread_id: thread!.id,
        account_id: graph.accountId,
        direction: 'received',
        from_email: leadEmail,
        to_email: mailboxEmail,
        subject: 'Re: Quick check-in',
        body_text: 'Thanks',
        body_html: '<p>Thanks</p>',
        message_id: 'parent@example.com',
        in_reply_to: 'root@furnace.build',
        message_references: '<root@furnace.build>',
        reference_message_ids: ['root@furnace.build'],
        received_at: new Date().toISOString(),
        headers: {},
        attachments: [],
      })
      .select('*')
      .single();
    assert.equal(parentError, null);
    graph.manifest.messageIds.push(parent!.id);

    const { data: jobId, error: rpcError } = await harness.supabase.rpc('create_inbox_reply_job', {
      p_account_id: graph.accountId,
      p_thread_id: thread!.id,
      p_in_reply_to_message_id: parent!.id,
      p_subject: 'Re: Quick check-in',
      p_body_text: 'Sounds good',
      p_body_html: '<p>Sounds good</p>',
      p_to_email: leadEmail,
      p_to_name: 'Casey',
      p_cc: null,
      p_attachments: null,
    });
    assert.equal(rpcError, null, rpcError?.message);
    assert.ok(jobId);
    graph.manifest.messageJobIds.push(jobId as string);

    const { data: job, error: jobError } = await harness.supabase
      .from('message_jobs')
      .select('message_data, message_type')
      .eq('id', jobId)
      .single();
    assert.equal(jobError, null);
    assert.equal((job as any).message_type, 'inbox_reply');
    const md = (job as any).message_data;
    assert.equal(md.thread_id, thread!.id);
    assert.ok(String(md.in_reply_to).includes('parent@example.com'));
    const refs = parseMessageIds(md.message_references);
    assert.deepEqual(refs, ['root@furnace.build', 'parent@example.com']);
  } finally {
    await harness.cleanup();
  }
});
