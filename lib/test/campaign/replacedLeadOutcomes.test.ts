import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildLeadReplacementSummariesByLeadIds } from '../../leads/replacementSummary';
import {
  CampaignDbHarness,
  buildAlwaysOnSchedule,
  buildFlowData,
} from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  buildCampaignThread,
  buildThreadMessage,
  createCampaignTestNamespace,
} from './fixtures';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

async function loadReplacementResult(
  harness: CampaignDbHarness,
  args: {
    p_old_lead_id: string | null;
    p_new_email: string | null;
    p_new_name?: string | null;
    p_new_first_name?: string | null;
    p_new_last_name?: string | null;
    p_new_phone_number?: string | null;
    p_reason?: 'auto_reply_forward' | 'manual_referral' | 'wrong_contact' | 'role_change' | 'other';
    p_reason_note?: string | null;
    p_source_message_id?: string | null;
  }
) {
  return harness.supabase.rpc('replace_lead_with_new_contact', {
    p_old_lead_id: args.p_old_lead_id,
    p_new_email: args.p_new_email,
    p_new_name: args.p_new_name ?? null,
    p_new_first_name: args.p_new_first_name ?? null,
    p_new_last_name: args.p_new_last_name ?? null,
    p_new_phone_number: args.p_new_phone_number ?? null,
    p_reason: args.p_reason ?? 'manual_referral',
    p_reason_note: args.p_reason_note ?? null,
    p_source_message_id: args.p_source_message_id ?? null,
  });
}

type EnrollmentSnapshot = {
  id: string;
  lead_id: string;
  state: string | null;
  stopped_reason: string | null;
  stopped_at: string | null;
  next_run_at: string | null;
  current_node_id: string | null;
};

async function loadEnrollment(
  harness: CampaignDbHarness,
  enrollmentId: string
): Promise<EnrollmentSnapshot> {
  const { data, error } = await harness.supabase
    .from('enrollments')
    .select('id, lead_id, state, stopped_reason, stopped_at, next_run_at, current_node_id')
    .eq('id', enrollmentId)
    .single();
  assert.equal(error, null, error?.message);
  return data as EnrollmentSnapshot;
}

async function loadJobStatuses(
  harness: CampaignDbHarness,
  jobIds: string[]
): Promise<Map<string, { status: string; lead_id: string }>> {
  const { data, error } = await harness.supabase
    .from('message_jobs')
    .select('id, status, lead_id')
    .in('id', jobIds);
  assert.equal(error, null, error?.message);
  return new Map((data ?? []).map((row: any) => [row.id, { status: row.status, lead_id: row.lead_id }]));
}

async function loadDialTotals(
  harness: CampaignDbHarness,
  campaignId: string
): Promise<{ listEnrollmentCount: number; bucketTotal: number }> {
  const [listResult, bucketResult] = await Promise.all([
    harness.supabase.rpc('campaigns_list_summary', {
      p_account_id: harness.env.accountId,
      p_search: null,
      p_statuses: null,
      p_tag_ids: null,
      p_limit: null,
      p_cursor_created_at: null,
      p_cursor_id: null,
    }),
    harness.supabase.rpc('get_campaign_lead_progress_buckets', { p_campaign_id: campaignId }),
  ]);
  assert.equal(listResult.error, null, listResult.error?.message);
  assert.equal(bucketResult.error, null, bucketResult.error?.message);

  const listRow = ((listResult.data ?? []) as any[]).find((row) => row.id === campaignId);
  assert.ok(listRow, 'campaign missing from campaigns_list_summary');
  const bucketRow = (bucketResult.data ?? [])[0] as any;
  assert.ok(bucketRow, 'campaign missing from get_campaign_lead_progress_buckets');

  return {
    listEnrollmentCount: Number(listRow.enrollment_count),
    bucketTotal: Number(bucketRow.total_leads),
  };
}

async function fetchReceivedMessageId(harness: CampaignDbHarness, threadId: string): Promise<string> {
  const { data, error } = await harness.supabase
    .from('email_messages')
    .select('id')
    .eq('thread_id', threadId)
    .eq('direction', 'received')
    .order('received_at', { ascending: false })
    .limit(1)
    .single();
  assert.equal(error, null);
  assert.ok(data?.id);
  return data.id as string;
}

async function createForeignSourceMessage(harness: CampaignDbHarness): Promise<{
  messageId: string;
  cleanup: () => Promise<void>;
}> {
  const timestamp = new Date().toISOString();
  const accountId = randomUUID();
  const threadId = randomUUID();
  const messageId = randomUUID();

  const { error: accountError } = await harness.supabase.from('accounts').insert({
    id: accountId,
    name: `Replacement Test Foreign ${accountId.slice(0, 8)}`,
    created_at: timestamp,
    updated_at: timestamp,
  });
  assert.equal(accountError, null);

  const { error: threadError } = await harness.supabase.from('email_threads').insert({
    id: threadId,
    account_id: accountId,
    campaign_id: null,
    lead_id: null,
    enrollment_id: null,
    message_job_id: null,
    mailbox_id: null,
    subject: 'Foreign source message',
    participants: ['foreign@example.com', 'mailbox@example.com'],
    last_message_at: timestamp,
    last_inbound_at: timestamp,
    message_count: 1,
    has_reply: true,
    category: null,
    category_source: null,
    out_of_office: false,
    ooo_resume_requested: false,
    ooo_resume_at: null,
    ooo_resume_processed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  } as any);
  assert.equal(threadError, null);

  const { error: messageError } = await harness.supabase.from('email_messages').insert({
    id: messageId,
    thread_id: threadId,
    account_id: accountId,
    message_job_id: null,
    direction: 'received',
    from_email: 'foreign@example.com',
    from_name: 'Foreign Lead',
    to_email: 'mailbox@example.com',
    to_name: 'Mailbox',
    cc: null,
    subject: 'Foreign source message',
    body_text: 'This message belongs to another account.',
    body_html: null,
    message_id: '<foreign-source@furnace.test>',
    in_reply_to: null,
    message_references: null,
    received_at: timestamp,
    read_at: null,
    headers: {},
    attachments: [],
    created_at: timestamp,
    updated_at: timestamp,
  } as any);
  assert.equal(messageError, null);

  return {
    messageId,
    cleanup: async () => {
      await harness.supabase.from('email_messages').delete().eq('id', messageId);
      await harness.supabase.from('email_threads').delete().eq('id', threadId);
      await harness.supabase.from('accounts').delete().eq('id', accountId);
    },
  };
}

test('replace_lead_with_new_contact moves active enrollment, pending jobs, and thread to the new lead', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-move') });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead Move Outcomes',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `old-${harness.namespace}@furnace.test`,
          name: 'Legacy Contact',
          firstName: 'Legacy',
          lastName: 'Contact',
          companyName: 'Acme Legacy',
          phoneNumber: '555-0100',
          mailboxKey: 'mailbox-1',
          source: 'replaced-lead-test',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: new Date(now + 15 * 60 * 1000).toISOString(),
            flowPosition: { node: 'waitTime-1', step: 2 },
          }),
          jobs: [
            buildCampaignJob({
              key: 'pending-job',
              nodeFlowNodeId: 'email-2',
              status: 'queued',
              scheduledAt: new Date(now + 10 * 60 * 1000).toISOString(),
            }),
            buildCampaignJob({
              key: 'reserved-job',
              nodeFlowNodeId: 'email-2',
              status: 'reserved',
              scheduledAt: new Date(now + 20 * 60 * 1000).toISOString(),
            }),
            buildCampaignJob({
              key: 'sent-job',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
              scheduledAt: new Date(now - 60 * 60 * 1000).toISOString(),
              sentAt: new Date(now - 59 * 60 * 1000).toISOString(),
            }),
            buildCampaignJob({
              key: 'failed-job',
              nodeFlowNodeId: 'email-2',
              status: 'failed',
              scheduledAt: new Date(now - 30 * 60 * 1000).toISOString(),
            }),
          ],
          thread: buildCampaignThread({
            subject: 'Legacy thread',
            lastMessageAt: new Date(now - 5 * 60 * 1000).toISOString(),
            messageJobKey: 'pending-job',
            messages: [
              buildThreadMessage({
                direction: 'sent',
                receivedAt: new Date(now - 60 * 60 * 1000).toISOString(),
                readAt: new Date(now - 60 * 60 * 1000).toISOString(),
                messageId: '<legacy-sent@furnace.test>',
              }),
              buildThreadMessage({
                direction: 'received',
                bodyText: 'Please contact the new person instead.',
                receivedAt: new Date(now - 5 * 60 * 1000).toISOString(),
                readAt: null,
                messageId: '<legacy-received@furnace.test>',
                inReplyTo: '<legacy-sent@furnace.test>',
                messageReferences: '<legacy-sent@furnace.test>',
              }),
            ],
          }),
        }),
      ],
    });

    const oldLead = graph.leadsByKey.get('old')!;
    const newEmail = `new-contact-${harness.namespace}@furnace.test`;
    const sourceMessageId = await fetchReceivedMessageId(harness, oldLead.threadId!);

    const { error: oldLeadUpdateError } = await harness.supabase
      .from('leads')
      .update({
        website: 'https://legacy.example.com',
        linkedin_url: 'https://linkedin.com/in/legacy',
        company_linkedin_url: 'https://linkedin.com/company/acme',
        custom_lead_data: { team: 'sales', region: 'west' },
        smartlead_lead_id: 123456,
        updated_at: new Date(now).toISOString(),
      } as any)
      .eq('id', oldLead.leadId);
    assert.equal(oldLeadUpdateError, null);

    const { error: threadUpdateError } = await harness.supabase
      .from('email_threads')
      .update({
        participants: [
          graph.mailboxEmailsByKey.get('mailbox-1')!,
          `old-${harness.namespace}@furnace.test`,
          newEmail,
        ],
      } as any)
      .eq('id', oldLead.threadId!);
    assert.equal(threadUpdateError, null);

    const result = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: `  ${newEmail.toUpperCase()}  `,
      p_new_name: 'New Decision Maker',
      p_new_first_name: 'New',
      p_new_last_name: 'Decision Maker',
      p_new_phone_number: '555-0101',
      p_reason_note: 'OOO suggested the new contact',
      p_source_message_id: sourceMessageId,
    });
    assert.equal(result.error, null);

    const rpcRow = result.data?.[0];
    assert.ok(rpcRow?.replacement_id);
    assert.ok(rpcRow?.new_lead_id);
    harness.recordReplacement({
      replacementId: rpcRow!.replacement_id,
      newLeadId: rpcRow!.new_lead_id,
    });

    const { data: leadRows, error: leadError } = await harness.supabase
      .from('leads')
      .select(
        'id, account_id, campaign_id, bucket_id, email, name, first_name, last_name, company_name, website, linkedin_url, company_linkedin_url, phone_number, source, custom_lead_data, global_lead_id, smartlead_lead_id, mailbox_id, deleted_at'
      )
      .in('id', [oldLead.leadId, rpcRow!.new_lead_id]);
    assert.equal(leadError, null);
    const leadsById = new Map((leadRows ?? []).map((row: any) => [row.id, row]));
    const oldLeadRow = leadsById.get(oldLead.leadId);
    const newLeadRow = leadsById.get(rpcRow!.new_lead_id);
    assert.ok(oldLeadRow?.deleted_at);
    assert.equal(newLeadRow?.email, newEmail);
    assert.equal(newLeadRow?.name, 'New Decision Maker');
    assert.equal(newLeadRow?.first_name, 'New');
    assert.equal(newLeadRow?.last_name, 'Decision Maker');
    assert.equal(newLeadRow?.company_name, 'Acme Legacy');
    assert.equal(newLeadRow?.website, 'https://legacy.example.com');
    assert.equal(newLeadRow?.linkedin_url, 'https://linkedin.com/in/legacy');
    assert.equal(newLeadRow?.company_linkedin_url, 'https://linkedin.com/company/acme');
    assert.equal(newLeadRow?.phone_number, '555-0101');
    assert.equal(newLeadRow?.source, 'replaced-lead-test');
    assert.deepEqual(newLeadRow?.custom_lead_data, { team: 'sales', region: 'west' });
    assert.equal(newLeadRow?.smartlead_lead_id, null);
    assert.equal(newLeadRow?.global_lead_id, hashGlobalLeadId(newEmail));
    assert.equal(newLeadRow?.account_id, graph.accountId);
    assert.equal(newLeadRow?.campaign_id, graph.campaignId);
    assert.equal(newLeadRow?.bucket_id, graph.bucketId);
    assert.equal(newLeadRow?.mailbox_id, graph.mailboxIdsByKey.get('mailbox-1'));

    const { data: enrollmentRow, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('id, lead_id, current_node_id, state, next_run_at, flow_position')
      .eq('id', oldLead.enrollmentId!)
      .single();
    assert.equal(enrollmentError, null);
    assert.equal(enrollmentRow?.id, rpcRow?.enrollment_id);
    assert.equal(enrollmentRow?.lead_id, rpcRow?.new_lead_id);
    assert.equal(enrollmentRow?.state, 'active');
    assert.equal(enrollmentRow?.current_node_id, graph.nodeIdsByFlowNodeId.get('waitTime-1'));
    assert.equal(
      Date.parse(enrollmentRow?.next_run_at ?? ''),
      Date.parse(new Date(now + 15 * 60 * 1000).toISOString())
    );
    assert.deepEqual(enrollmentRow?.flow_position, { node: 'waitTime-1', step: 2 });

    const jobIds = Array.from(oldLead.messageJobIdsByKey.values());
    const { data: jobRows, error: jobError } = await harness.supabase
      .from('message_jobs')
      .select('id, lead_id, status')
      .in('id', jobIds);
    assert.equal(jobError, null);
    const jobsById = new Map((jobRows ?? []).map((row: any) => [row.id, row]));
    assert.equal(jobsById.get(oldLead.messageJobIdsByKey.get('pending-job')!)?.lead_id, rpcRow?.new_lead_id);
    assert.equal(jobsById.get(oldLead.messageJobIdsByKey.get('reserved-job')!)?.lead_id, rpcRow?.new_lead_id);
    assert.equal(jobsById.get(oldLead.messageJobIdsByKey.get('sent-job')!)?.lead_id, oldLead.leadId);
    assert.equal(jobsById.get(oldLead.messageJobIdsByKey.get('failed-job')!)?.lead_id, oldLead.leadId);

    const { data: threadRow, error: threadError } = await harness.supabase
      .from('email_threads')
      .select('lead_id, participants')
      .eq('id', oldLead.threadId!)
      .single();
    assert.equal(threadError, null);
    assert.equal(threadRow?.lead_id, rpcRow?.new_lead_id);
    assert.equal((threadRow?.participants ?? []).filter((email: string) => email === newEmail).length, 1);

    const { data: replacementRow, error: replacementError } = await harness.supabase
      .from('lead_replacements')
      .select('id, account_id, campaign_id, old_lead_id, new_lead_id, status, reason, reason_note, source_message_id, completed_at')
      .eq('id', rpcRow!.replacement_id)
      .single();
    assert.equal(replacementError, null);
    assert.equal(replacementRow?.account_id, graph.accountId);
    assert.equal(replacementRow?.campaign_id, graph.campaignId);
    assert.equal(replacementRow?.old_lead_id, oldLead.leadId);
    assert.equal(replacementRow?.new_lead_id, rpcRow?.new_lead_id);
    assert.equal(replacementRow?.status, 'completed');
    assert.equal(replacementRow?.reason, 'manual_referral');
    assert.equal(replacementRow?.reason_note, 'OOO suggested the new contact');
    assert.equal(replacementRow?.source_message_id, sourceMessageId);
    assert.ok(replacementRow?.completed_at);
  } finally {
    await harness.cleanup();
  }
});

test('replace_lead_with_new_contact preserves sent failed blocked and cancelled jobs on the old lead', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-job-status') });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead Status Outcomes',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `old-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: new Date(now + 5 * 60 * 1000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({ key: 'pending-job', status: 'queued', scheduledAt: new Date(now + 5 * 60 * 1000).toISOString() }),
            buildCampaignJob({ key: 'sent-job', status: 'sent', scheduledAt: new Date(now - 60 * 60 * 1000).toISOString(), sentAt: new Date(now - 59 * 60 * 1000).toISOString() }),
            buildCampaignJob({ key: 'failed-job', status: 'failed', scheduledAt: new Date(now - 30 * 60 * 1000).toISOString() }),
            buildCampaignJob({ key: 'blocked-job', status: 'blocked', scheduledAt: new Date(now - 20 * 60 * 1000).toISOString() }),
            buildCampaignJob({ key: 'cancelled-job', status: 'cancelled', scheduledAt: new Date(now - 10 * 60 * 1000).toISOString() }),
          ],
          thread: buildCampaignThread({
            subject: 'Status thread',
            lastMessageAt: new Date(now - 5 * 60 * 1000).toISOString(),
            messageJobKey: 'pending-job',
          }),
        }),
      ],
    });

    const oldLead = graph.leadsByKey.get('old')!;
    const result = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: `new-${harness.namespace}@furnace.test`,
    });
    assert.equal(result.error, null);
    const rpcRow = result.data?.[0];
    assert.ok(rpcRow);
    harness.recordReplacement({
      replacementId: rpcRow!.replacement_id,
      newLeadId: rpcRow!.new_lead_id,
    });

    const { data: jobRows, error: jobError } = await harness.supabase
      .from('message_jobs')
      .select('id, lead_id')
      .in('id', Array.from(oldLead.messageJobIdsByKey.values()));
    assert.equal(jobError, null);
    const jobsById = new Map((jobRows ?? []).map((row: any) => [row.id, row]));

    assert.equal(jobsById.get(oldLead.messageJobIdsByKey.get('pending-job')!)?.lead_id, rpcRow?.new_lead_id);
    assert.equal(jobsById.get(oldLead.messageJobIdsByKey.get('sent-job')!)?.lead_id, oldLead.leadId);
    assert.equal(jobsById.get(oldLead.messageJobIdsByKey.get('failed-job')!)?.lead_id, oldLead.leadId);
    assert.equal(jobsById.get(oldLead.messageJobIdsByKey.get('blocked-job')!)?.lead_id, oldLead.leadId);
    assert.equal(jobsById.get(oldLead.messageJobIdsByKey.get('cancelled-job')!)?.lead_id, oldLead.leadId);
  } finally {
    await harness.cleanup();
  }
});

test('replace_lead_with_new_contact rejects duplicate self-targeting and missing-input replacements', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-validation') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead Validation',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `old-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
          }),
          thread: buildCampaignThread({
            subject: 'Validation thread',
            lastMessageAt: new Date().toISOString(),
          }),
        }),
      ],
    });

    const oldLead = graph.leadsByKey.get('old')!;
    const success = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: `new-${harness.namespace}@furnace.test`,
    });
    assert.equal(success.error, null);
    const successRow = success.data?.[0];
    assert.ok(successRow);
    harness.recordReplacement({
      replacementId: successRow!.replacement_id,
      newLeadId: successRow!.new_lead_id,
    });

    const { error: reviveError } = await harness.supabase
      .from('leads')
      .update({
        deleted_at: null,
      } as any)
      .eq('id', oldLead.leadId);
    assert.equal(reviveError, null);

    const duplicate = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: `second-${harness.namespace}@furnace.test`,
    });
    assert.match(duplicate.error?.message ?? '', /Lead already has a replacement/);

    const sameEmailHarness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-same-email') });
    try {
      const sameEmailGraph = await sameEmailHarness.createCampaignGraph({
        name: 'Replaced Lead Same Email',
        status: 'running',
        flowKind: 'emailOnly',
        leads: [
          buildCampaignLead({
            key: 'old',
            email: `same-${sameEmailHarness.namespace}@furnace.test`,
            mailboxKey: 'mailbox-1',
            enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
          }),
        ],
      });

      const sameEmailLead = sameEmailGraph.leadsByKey.get('old')!;
      const sameEmail = await loadReplacementResult(sameEmailHarness, {
        p_old_lead_id: sameEmailLead.leadId,
        p_new_email: ` SAME-${sameEmailHarness.namespace}@furnace.test `,
      });
      assert.match(
        sameEmail.error?.message ?? '',
        /Replacement email must differ from the original lead email/
      );
    } finally {
      await sameEmailHarness.cleanup();
    }

    const missingLeadId = await loadReplacementResult(harness, {
      p_old_lead_id: null,
      p_new_email: 'missing@example.com',
    });
    assert.match(missingLeadId.error?.message ?? '', /old_lead_id is required/);

    const missingEmail = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: '   ',
    });
    assert.match(missingEmail.error?.message ?? '', /new_email is required/);

    const missingLead = await loadReplacementResult(harness, {
      p_old_lead_id: randomUUID(),
      p_new_email: 'missing-lead@example.com',
    });
    assert.match(missingLead.error?.message ?? '', /Lead not found or already removed/);
  } finally {
    await harness.cleanup();
  }
});

test('replace_lead_with_new_contact validates source_message_id ownership and stores a valid source message', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-source-message') });
  let foreignSourceCleanup: (() => Promise<void>) | null = null;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead Source Message',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `old-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
          }),
          thread: buildCampaignThread({
            subject: 'Source message thread',
            lastMessageAt: new Date().toISOString(),
          }),
        }),
      ],
    });

    const oldLead = graph.leadsByKey.get('old')!;
    const sourceMessageId = await fetchReceivedMessageId(harness, oldLead.threadId!);
    const foreignSource = await createForeignSourceMessage(harness);
    foreignSourceCleanup = foreignSource.cleanup;

    const invalid = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: `invalid-${harness.namespace}@furnace.test`,
      p_source_message_id: foreignSource.messageId,
    });
    assert.match(invalid.error?.message ?? '', /source_message_id does not belong to this account/);

    const valid = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: `valid-${harness.namespace}@furnace.test`,
      p_source_message_id: sourceMessageId,
      p_reason_note: 'Valid source message',
    });
    assert.equal(valid.error, null);
    const validRow = valid.data?.[0];
    assert.ok(validRow);
    harness.recordReplacement({
      replacementId: validRow!.replacement_id,
      newLeadId: validRow!.new_lead_id,
    });

    const { data: replacementRow, error: replacementError } = await harness.supabase
      .from('lead_replacements')
      .select('source_message_id')
      .eq('id', validRow!.replacement_id)
      .single();
    assert.equal(replacementError, null);
    assert.equal(replacementRow?.source_message_id, sourceMessageId);
  } finally {
    if (foreignSourceCleanup) {
      await foreignSourceCleanup();
    }
    await harness.cleanup();
  }
});

test('replace_lead_with_new_contact accepts every replacement_reason_enum value', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-reasons') });
  const reasons = [
    'auto_reply_forward',
    'manual_referral',
    'wrong_contact',
    'role_change',
    'other',
  ] as const;

  try {
    for (const reason of reasons) {
      const graph = await harness.createCampaignGraph({
        name: `Replaced Lead Reason ${reason}`,
        status: 'running',
        flowKind: 'emailOnly',
        leads: [
          buildCampaignLead({
            key: `old-${reason}`,
            email: `${reason}-${harness.namespace}@furnace.test`,
            mailboxKey: 'mailbox-1',
            enrollment: buildCampaignEnrollment({
              state: 'active',
              currentFlowNodeId: 'email-1',
            }),
          }),
        ],
      });

      const oldLead = graph.leadsByKey.get(`old-${reason}`)!;
      const result = await loadReplacementResult(harness, {
        p_old_lead_id: oldLead.leadId,
        p_new_email: `new-${reason}-${harness.namespace}@furnace.test`,
        p_reason: reason,
      });
      assert.equal(result.error, null);
      const rpcRow = result.data?.[0];
      assert.ok(rpcRow);
      harness.recordReplacement({
        replacementId: rpcRow!.replacement_id,
        newLeadId: rpcRow!.new_lead_id,
      });

      const { data: replacementRow, error: replacementError } = await harness.supabase
        .from('lead_replacements')
        .select('reason')
        .eq('id', rpcRow!.replacement_id)
        .single();
      assert.equal(replacementError, null);
      assert.equal(replacementRow?.reason, reason);
    }
  } finally {
    await harness.cleanup();
  }
});

test('OOO resume after replacement reactivates the new lead enrollment without touching the old lead', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-ooo') });
  const now = Date.now();
  const resumeAt = new Date(now - 60_000).toISOString();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead OOO Resume',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `old-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: null,
            stoppedReason: 'replied',
            stoppedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'campaign-pending',
              nodeFlowNodeId: 'email-2',
              status: 'queued',
              scheduledAt: new Date(now - 10 * 60 * 1000).toISOString(),
            }),
          ],
          thread: buildCampaignThread({
            subject: '[RESUME NOW] replaced lead',
            lastMessageAt: new Date(now - 5 * 60 * 1000).toISOString(),
            outOfOffice: true,
            oooResumeRequested: true,
            oooResumeAt: resumeAt,
            oooResumeProcessedAt: null,
            messageJobKey: 'campaign-pending',
          }),
        }),
      ],
    });

    const oldLead = graph.leadsByKey.get('old')!;
    const result = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: `new-${harness.namespace}@furnace.test`,
    });
    assert.equal(result.error, null);
    const rpcRow = result.data?.[0];
    assert.ok(rpcRow);
    harness.recordReplacement({
      replacementId: rpcRow!.replacement_id,
      newLeadId: rpcRow!.new_lead_id,
    });
    assert.equal(rpcRow?.enrollment_id, oldLead.enrollmentId);

    const processed = await harness.supabase.rpc('process_due_out_of_office_resumes', {
      p_batch_size: 50,
    });
    assert.equal(processed.error, null);
    assert.ok(typeof processed.data === 'number' && processed.data >= 1);

    const { data: enrollmentRow, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('id, lead_id, state, stopped_reason, next_run_at')
      .eq('id', oldLead.enrollmentId!)
      .single();
    assert.equal(enrollmentError, null);
    assert.equal(enrollmentRow?.id, oldLead.enrollmentId);
    assert.equal(enrollmentRow?.lead_id, rpcRow?.new_lead_id);
    assert.equal(enrollmentRow?.state, 'active');
    assert.equal(enrollmentRow?.stopped_reason, null);
    assert.ok(enrollmentRow?.next_run_at);

    const { data: movedJobRow, error: movedJobError } = await harness.supabase
      .from('message_jobs')
      .select('lead_id, scheduled_at')
      .eq('id', oldLead.messageJobIdsByKey.get('campaign-pending')!)
      .single();
    assert.equal(movedJobError, null);
    assert.equal(movedJobRow?.lead_id, rpcRow?.new_lead_id);
    assert.ok(Date.parse(movedJobRow?.scheduled_at ?? '') >= Date.parse(resumeAt) + 30_000);

    const { data: threadRow, error: threadError } = await harness.supabase
      .from('email_threads')
      .select('lead_id, ooo_resume_requested, ooo_resume_processed_at')
      .eq('id', oldLead.threadId!)
      .single();
    assert.equal(threadError, null);
    assert.equal(threadRow?.lead_id, rpcRow?.new_lead_id);
    assert.equal(threadRow?.ooo_resume_requested, false);
    assert.ok(threadRow?.ooo_resume_processed_at);

    const { data: oldLeadRow, error: oldLeadError } = await harness.supabase
      .from('leads')
      .select('deleted_at')
      .eq('id', oldLead.leadId)
      .single();
    assert.equal(oldLeadError, null);
    assert.ok(oldLeadRow?.deleted_at);
  } finally {
    await harness.cleanup();
  }
});

test('DB-backed replacement summary queries return matching summaries for both old and new leads', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-summary-helper') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead Summary Helper',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `old-${harness.namespace}@furnace.test`,
          name: 'Old Contact',
          firstName: 'Old',
          lastName: 'Contact',
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
          }),
        }),
      ],
    });

    const oldLead = graph.leadsByKey.get('old')!;
    const result = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: `new-${harness.namespace}@furnace.test`,
      p_new_name: 'New Contact',
    });
    assert.equal(result.error, null);
    const rpcRow = result.data?.[0];
    assert.ok(rpcRow);
    harness.recordReplacement({
      replacementId: rpcRow!.replacement_id,
      newLeadId: rpcRow!.new_lead_id,
    });

    const leadIds = [oldLead.leadId, rpcRow!.new_lead_id];
    const [oldReplacementQuery, newReplacementQuery, leadQuery] = await Promise.all([
      harness.supabase
        .from('lead_replacements')
        .select('id, old_lead_id, new_lead_id, reason, reason_note, created_at, completed_at')
        .in('old_lead_id', leadIds)
        .neq('status', 'cancelled'),
      harness.supabase
        .from('lead_replacements')
        .select('id, old_lead_id, new_lead_id, reason, reason_note, created_at, completed_at')
        .in('new_lead_id', leadIds)
        .neq('status', 'cancelled'),
      harness.supabase
        .from('leads')
        .select('id, name, first_name, last_name, email')
        .in('id', leadIds),
    ]);
    assert.equal(oldReplacementQuery.error, null);
    assert.equal(newReplacementQuery.error, null);
    assert.equal(leadQuery.error, null);
    const replacementRows = [...(oldReplacementQuery.data ?? []), ...(newReplacementQuery.data ?? [])];

    const summaries = buildLeadReplacementSummariesByLeadIds({
      leadIds,
      replacements: replacementRows as any,
      counterpartLeadsById: new Map((leadQuery.data ?? []).map((lead: any) => [lead.id, lead])),
    });

    assert.equal(summaries[oldLead.leadId]?.role, 'old');
    assert.equal(summaries[oldLead.leadId]?.counterpartLeadId, rpcRow!.new_lead_id);
    assert.equal(summaries[oldLead.leadId]?.counterpartLabel, 'New Contact');
    assert.equal(summaries[rpcRow!.new_lead_id]?.role, 'new');
    assert.equal(summaries[rpcRow!.new_lead_id]?.counterpartLeadId, oldLead.leadId);
    assert.equal(summaries[rpcRow!.new_lead_id]?.counterpartLabel, 'Old Contact');
  } finally {
    await harness.cleanup();
  }
});

test('replacing to an address already live in the campaign attaches to that contact instead of duplicating', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-attach') });
  const now = Date.now();
  const targetEmail = `attach-target-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead Attach',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `attach-old-${harness.namespace}@furnace.test`,
          name: 'Referring Contact',
          companyName: 'Acme Legacy',
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: new Date(now + 15 * 60 * 1000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({ key: 'old-queued', nodeFlowNodeId: 'email-2', status: 'queued', scheduledAt: new Date(now + 10 * 60 * 1000).toISOString() }),
            buildCampaignJob({ key: 'old-reserved', nodeFlowNodeId: 'email-2', status: 'reserved', scheduledAt: new Date(now + 20 * 60 * 1000).toISOString() }),
            buildCampaignJob({ key: 'old-sent', nodeFlowNodeId: 'email-1', status: 'sent', scheduledAt: new Date(now - 60 * 60 * 1000).toISOString(), sentAt: new Date(now - 59 * 60 * 1000).toISOString() }),
            buildCampaignJob({ key: 'old-failed', nodeFlowNodeId: 'email-2', status: 'failed', scheduledAt: new Date(now - 30 * 60 * 1000).toISOString() }),
            buildCampaignJob({ key: 'old-blocked', nodeFlowNodeId: 'email-2', status: 'blocked', scheduledAt: new Date(now - 25 * 60 * 1000).toISOString() }),
          ],
          thread: buildCampaignThread({
            subject: 'Referral thread',
            lastMessageAt: new Date(now - 5 * 60 * 1000).toISOString(),
            messageJobKey: 'old-sent',
          }),
        }),
        buildCampaignLead({
          key: 'target',
          email: targetEmail,
          name: 'Existing Contact',
          firstName: 'Existing',
          lastName: 'Contact',
          companyName: 'Target Co',
          phoneNumber: '555-9000',
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: new Date(now + 45 * 60 * 1000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({ key: 'target-queued', nodeFlowNodeId: 'email-2', status: 'queued', scheduledAt: new Date(now + 45 * 60 * 1000).toISOString() }),
          ],
        }),
      ],
    });

    const oldLead = graph.leadsByKey.get('old')!;
    const target = graph.leadsByKey.get('target')!;
    const dialsBefore = await loadDialTotals(harness, graph.campaignId);
    const targetBefore = await loadEnrollment(harness, target.enrollmentId!);

    // Mixed case on purpose: the match is lower(btrim(email)) on both sides.
    const result = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: `  ${targetEmail.toUpperCase()}  `,
      p_new_name: 'Referred Person',
      p_new_phone_number: '555-1111',
    });
    assert.equal(result.error, null, result.error?.message);
    const rpcRow = result.data?.[0];
    assert.ok(rpcRow);
    harness.recordReplacement({ replacementId: rpcRow!.replacement_id, newLeadId: rpcRow!.new_lead_id });

    assert.equal(rpcRow?.mode, 'attached');
    assert.equal(rpcRow?.new_lead_id, target.leadId);
    assert.equal(rpcRow?.target_lead_id, target.leadId);
    assert.equal(rpcRow?.enrollment_id, target.enrollmentId);
    assert.equal(rpcRow?.retired_sibling_count, 0);

    const { data: sameEmailLeads, error: sameEmailError } = await harness.supabase
      .from('leads')
      .select('id')
      .eq('campaign_id', graph.campaignId)
      .is('deleted_at', null)
      .ilike('email', targetEmail);
    assert.equal(sameEmailError, null, sameEmailError?.message);
    assert.deepEqual((sameEmailLeads ?? []).map((row: any) => row.id), [target.leadId]);

    const { data: threadRow, error: threadError } = await harness.supabase
      .from('email_threads')
      .select('lead_id, enrollment_id, participants')
      .eq('id', oldLead.threadId!)
      .single();
    assert.equal(threadError, null, threadError?.message);
    assert.equal(threadRow?.lead_id, target.leadId);
    assert.equal(threadRow?.enrollment_id, target.enrollmentId);
    assert.equal(
      (threadRow?.participants ?? []).filter((email: string) => email === targetEmail).length,
      1
    );

    const oldEnrollment = await loadEnrollment(harness, oldLead.enrollmentId!);
    assert.equal(oldEnrollment.lead_id, oldLead.leadId);
    assert.equal(oldEnrollment.state, 'stopped');
    assert.equal(oldEnrollment.stopped_reason, 'replaced');
    assert.equal(oldEnrollment.next_run_at, null);
    assert.ok(oldEnrollment.stopped_at);

    const targetAfter = await loadEnrollment(harness, target.enrollmentId!);
    assert.deepEqual(targetAfter, targetBefore);

    const { data: oldLeadRow, error: oldLeadError } = await harness.supabase
      .from('leads')
      .select('deleted_at')
      .eq('id', oldLead.leadId)
      .single();
    assert.equal(oldLeadError, null, oldLeadError?.message);
    assert.equal(oldLeadRow?.deleted_at, null);

    const oldJobs = await loadJobStatuses(harness, Array.from(oldLead.messageJobIdsByKey.values()));
    assert.equal(oldJobs.get(oldLead.messageJobIdsByKey.get('old-queued')!)?.status, 'cancelled');
    assert.equal(oldJobs.get(oldLead.messageJobIdsByKey.get('old-reserved')!)?.status, 'cancelled');
    assert.equal(oldJobs.get(oldLead.messageJobIdsByKey.get('old-sent')!)?.status, 'sent');
    assert.equal(oldJobs.get(oldLead.messageJobIdsByKey.get('old-failed')!)?.status, 'failed');
    assert.equal(oldJobs.get(oldLead.messageJobIdsByKey.get('old-blocked')!)?.status, 'blocked');
    for (const job of oldJobs.values()) {
      assert.equal(job.lead_id, oldLead.leadId, 'attach must not move jobs onto the target');
    }

    const targetJobs = await loadJobStatuses(harness, Array.from(target.messageJobIdsByKey.values()));
    assert.equal(targetJobs.get(target.messageJobIdsByKey.get('target-queued')!)?.status, 'queued');

    const { data: targetLeadRow, error: targetLeadError } = await harness.supabase
      .from('leads')
      .select('name, first_name, last_name, phone_number, company_name')
      .eq('id', target.leadId)
      .single();
    assert.equal(targetLeadError, null, targetLeadError?.message);
    assert.equal(targetLeadRow?.name, 'Existing Contact');
    assert.equal(targetLeadRow?.first_name, 'Existing');
    assert.equal(targetLeadRow?.last_name, 'Contact');
    assert.equal(targetLeadRow?.phone_number, '555-9000');
    assert.equal(targetLeadRow?.company_name, 'Target Co');

    const { data: replacementRow, error: replacementError } = await harness.supabase
      .from('lead_replacements')
      .select('old_lead_id, new_lead_id, status')
      .eq('id', rpcRow!.replacement_id)
      .single();
    assert.equal(replacementError, null, replacementError?.message);
    assert.equal(replacementRow?.old_lead_id, oldLead.leadId);
    assert.equal(replacementRow?.new_lead_id, target.leadId);

    const dialsAfter = await loadDialTotals(harness, graph.campaignId);
    assert.deepEqual(dialsAfter, dialsBefore);
    assert.equal(dialsAfter.listEnrollmentCount, dialsAfter.bucketTotal);
  } finally {
    await harness.cleanup();
  }
});

test('attach fills only blank fields on the existing contact', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-attach-fill') });
  const targetEmail = `fill-target-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead Attach Fill',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `fill-old-${harness.namespace}@furnace.test`,
          companyName: 'Referrer Co',
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
        }),
        buildCampaignLead({
          key: 'target',
          email: targetEmail,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
        }),
      ],
    });

    const oldLead = graph.leadsByKey.get('old')!;
    const target = graph.leadsByKey.get('target')!;

    const { error: blankError } = await harness.supabase
      .from('leads')
      .update({
        name: null,
        first_name: null,
        last_name: '   ',
        phone_number: null,
        company_name: 'Keep This Company',
        custom_lead_data: { region: 'east' },
      } as any)
      .eq('id', target.leadId);
    assert.equal(blankError, null, blankError?.message);

    const { error: oldCustomError } = await harness.supabase
      .from('leads')
      .update({ custom_lead_data: { region: 'west', team: 'sales' } } as any)
      .eq('id', oldLead.leadId);
    assert.equal(oldCustomError, null, oldCustomError?.message);

    const preview = await harness.supabase.rpc('preview_replacement_target', {
      p_account_id: graph.accountId,
      p_campaign_id: graph.campaignId,
      p_email: targetEmail,
      p_old_lead_id: oldLead.leadId,
    });
    assert.equal(preview.error, null, preview.error?.message);
    const previewLead = (preview.data as any)?.existingLead;
    assert.ok(previewLead, 'preview should resolve the existing contact');
    assert.equal(previewLead.id, target.leadId);
    assert.equal(previewLead.companyName, 'Keep This Company');
    assert.equal(previewLead.phoneNumber, null);
    assert.equal(previewLead.lastName, '   ');
    assert.deepEqual(previewLead.customLeadData, { region: 'east' });

    const result = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: targetEmail,
      p_new_name: 'Filled Name',
      p_new_first_name: 'Filled',
      p_new_last_name: 'Person',
      p_new_phone_number: '555-2222',
    });
    assert.equal(result.error, null, result.error?.message);
    const rpcRow = result.data?.[0];
    assert.equal(rpcRow?.mode, 'attached');
    harness.recordReplacement({ replacementId: rpcRow!.replacement_id, newLeadId: rpcRow!.new_lead_id });

    const { data: targetRow, error: targetError } = await harness.supabase
      .from('leads')
      .select('name, first_name, last_name, phone_number, company_name, custom_lead_data')
      .eq('id', target.leadId)
      .single();
    assert.equal(targetError, null, targetError?.message);
    assert.equal(targetRow?.name, 'Filled Name');
    assert.equal(targetRow?.first_name, 'Filled');
    assert.equal(targetRow?.last_name, 'Person');
    assert.equal(targetRow?.phone_number, '555-2222');
    assert.equal(targetRow?.company_name, 'Keep This Company');
    // The target's own keys win on merge; the referrer only contributes new ones.
    assert.deepEqual(targetRow?.custom_lead_data, { region: 'east', team: 'sales' });
  } finally {
    await harness.cleanup();
  }
});

test('attach picks the primary deterministically and retires only siblings that can still send', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-attach-siblings') });
  const now = Date.now();
  const sharedEmail = `sibling-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead Attach Siblings',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `sibling-old-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'waitTime-1' }),
          thread: buildCampaignThread({
            subject: 'Sibling referral thread',
            lastMessageAt: new Date(now - 5 * 60 * 1000).toISOString(),
          }),
        }),
        // Completed but with the most recent thread activity: loses to the active row.
        buildCampaignLead({
          key: 'dupe-completed',
          email: sharedEmail,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'completed', currentFlowNodeId: 'email-2', nextRunAt: null }),
          jobs: [
            buildCampaignJob({ key: 'completed-queued', nodeFlowNodeId: 'email-2', status: 'queued', scheduledAt: new Date(now + 60 * 60 * 1000).toISOString() }),
          ],
          thread: buildCampaignThread({
            subject: 'Newest activity',
            lastMessageAt: new Date(now - 60 * 1000).toISOString(),
          }),
        }),
        // Active: wins the ranking regardless of activity or age.
        buildCampaignLead({
          key: 'dupe-active',
          email: sharedEmail,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: new Date(now + 30 * 60 * 1000).toISOString(),
          }),
        }),
        buildCampaignLead({
          key: 'dupe-paused',
          email: sharedEmail,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'paused', currentFlowNodeId: 'waitTime-1', nextRunAt: null }),
          jobs: [
            buildCampaignJob({ key: 'paused-queued', nodeFlowNodeId: 'email-2', status: 'queued', scheduledAt: new Date(now + 90 * 60 * 1000).toISOString() }),
            buildCampaignJob({ key: 'paused-sent', nodeFlowNodeId: 'email-1', status: 'sent', scheduledAt: new Date(now - 60 * 60 * 1000).toISOString(), sentAt: new Date(now - 59 * 60 * 1000).toISOString() }),
          ],
          thread: buildCampaignThread({
            subject: 'Paused sibling thread',
            lastMessageAt: new Date(now - 30 * 60 * 1000).toISOString(),
          }),
        }),
        buildCampaignLead({
          key: 'dupe-stopped',
          email: sharedEmail,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'email-1',
            nextRunAt: null,
            stoppedReason: 'replied',
            stoppedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
          }),
        }),
      ],
    });

    const oldLead = graph.leadsByKey.get('old')!;
    const active = graph.leadsByKey.get('dupe-active')!;
    const completed = graph.leadsByKey.get('dupe-completed')!;
    const paused = graph.leadsByKey.get('dupe-paused')!;
    const stopped = graph.leadsByKey.get('dupe-stopped')!;

    const previewBefore = await harness.supabase.rpc('preview_replacement_target', {
      p_account_id: graph.accountId,
      p_campaign_id: graph.campaignId,
      p_email: sharedEmail,
      p_old_lead_id: oldLead.leadId,
    });
    assert.equal(previewBefore.error, null, previewBefore.error?.message);
    const previewPayload = previewBefore.data as any;
    assert.equal(previewPayload.duplicateCount, 4);
    assert.equal(previewPayload.existingLead.id, active.leadId);
    assert.equal(previewPayload.existingLead.enrollmentId, active.enrollmentId);

    const completedBefore = await loadEnrollment(harness, completed.enrollmentId!);
    const stoppedBefore = await loadEnrollment(harness, stopped.enrollmentId!);

    const result = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: sharedEmail,
    });
    assert.equal(result.error, null, result.error?.message);
    const rpcRow = result.data?.[0];
    assert.ok(rpcRow);
    harness.recordReplacement({ replacementId: rpcRow!.replacement_id, newLeadId: rpcRow!.new_lead_id });

    // The form and the write must never name different people.
    assert.equal(rpcRow?.mode, 'attached');
    assert.equal(rpcRow?.target_lead_id, active.leadId);
    assert.equal(rpcRow?.target_lead_id, previewPayload.existingLead.id);
    assert.equal(rpcRow?.retired_sibling_count, 1);

    const activeAfter = await loadEnrollment(harness, active.enrollmentId!);
    assert.equal(activeAfter.state, 'active');
    assert.equal(activeAfter.stopped_reason, null);

    const pausedAfter = await loadEnrollment(harness, paused.enrollmentId!);
    assert.equal(pausedAfter.state, 'stopped');
    assert.equal(pausedAfter.stopped_reason, 'replaced');
    assert.equal(pausedAfter.next_run_at, null);

    assert.deepEqual(await loadEnrollment(harness, completed.enrollmentId!), completedBefore);
    assert.deepEqual(await loadEnrollment(harness, stopped.enrollmentId!), stoppedBefore);

    const pausedJobs = await loadJobStatuses(harness, Array.from(paused.messageJobIdsByKey.values()));
    assert.equal(pausedJobs.get(paused.messageJobIdsByKey.get('paused-queued')!)?.status, 'cancelled');
    assert.equal(pausedJobs.get(paused.messageJobIdsByKey.get('paused-sent')!)?.status, 'sent');

    // Exactly one live enrollment left for the referred address.
    const { data: liveEnrollments, error: liveError } = await harness.supabase
      .from('enrollments')
      .select('lead_id, state')
      .eq('campaign_id', graph.campaignId)
      .is('deleted_at', null)
      .in('lead_id', [active.leadId, completed.leadId, paused.leadId, stopped.leadId]);
    assert.equal(liveError, null, liveError?.message);
    const stillSending = (liveEnrollments ?? []).filter((row: any) =>
      row.state === 'active' || row.state === 'paused'
    );
    assert.deepEqual(stillSending.map((row: any) => row.lead_id), [active.leadId]);

    // Siblings keep their own conversations and get no replacement chip.
    const { data: siblingThread, error: siblingThreadError } = await harness.supabase
      .from('email_threads')
      .select('lead_id')
      .eq('id', paused.threadId!)
      .single();
    assert.equal(siblingThreadError, null, siblingThreadError?.message);
    assert.equal(siblingThread?.lead_id, paused.leadId);

    const { data: siblingReplacements, error: siblingReplacementError } = await harness.supabase
      .from('lead_replacements')
      .select('id')
      .in('old_lead_id', [completed.leadId, paused.leadId, stopped.leadId]);
    assert.equal(siblingReplacementError, null, siblingReplacementError?.message);
    assert.deepEqual(siblingReplacements ?? [], []);

    const { data: siblingLeads, error: siblingLeadError } = await harness.supabase
      .from('leads')
      .select('id, deleted_at')
      .in('id', [completed.leadId, paused.leadId, stopped.leadId]);
    assert.equal(siblingLeadError, null, siblingLeadError?.message);
    for (const row of siblingLeads ?? []) {
      assert.equal((row as any).deleted_at, null);
    }
  } finally {
    await harness.cleanup();
  }
});

test('attach refuses a target without a live enrollment and leaves every row untouched', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-attach-noenroll') });
  const targetEmail = `noenroll-target-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead Attach No Enrollment',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `noenroll-old-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
          jobs: [buildCampaignJob({ key: 'old-queued', status: 'queued' })],
          thread: buildCampaignThread({ subject: 'No enrollment thread' }),
        }),
        buildCampaignLead({
          key: 'target',
          email: targetEmail,
          mailboxKey: 'mailbox-1',
          enrollment: null,
        }),
      ],
    });

    const oldLead = graph.leadsByKey.get('old')!;
    const target = graph.leadsByKey.get('target')!;

    const preview = await harness.supabase.rpc('preview_replacement_target', {
      p_account_id: graph.accountId,
      p_campaign_id: graph.campaignId,
      p_email: targetEmail,
      p_old_lead_id: oldLead.leadId,
    });
    assert.equal(preview.error, null, preview.error?.message);
    assert.equal((preview.data as any).existingLead.id, target.leadId);
    assert.equal((preview.data as any).existingLead.enrollmentId, null);

    const result = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: targetEmail,
    });
    assert.match(result.error?.message ?? '', /has no active enrollment in this campaign/);

    const threadAfter = await harness.supabase
      .from('email_threads')
      .select('lead_id, enrollment_id')
      .eq('id', oldLead.threadId!)
      .single();
    assert.equal(threadAfter.error, null, threadAfter.error?.message);
    assert.equal(threadAfter.data?.lead_id, oldLead.leadId);
    assert.equal(threadAfter.data?.enrollment_id, oldLead.enrollmentId);

    const oldEnrollment = await loadEnrollment(harness, oldLead.enrollmentId!);
    assert.equal(oldEnrollment.state, 'active');
    assert.equal(oldEnrollment.stopped_reason, null);

    // Not an equality check on 'queued': a live worker on the shared test project
    // can legitimately reserve the job mid-test. What matters is that the failed
    // attach did not cancel it.
    const oldJobs = await loadJobStatuses(harness, Array.from(oldLead.messageJobIdsByKey.values()));
    assert.notEqual(oldJobs.get(oldLead.messageJobIdsByKey.get('old-queued')!)?.status, 'cancelled');

    const { data: replacementRows, error: replacementError } = await harness.supabase
      .from('lead_replacements')
      .select('id')
      .eq('old_lead_id', oldLead.leadId);
    assert.equal(replacementError, null, replacementError?.message);
    assert.deepEqual(replacementRows ?? [], []);
  } finally {
    await harness.cleanup();
  }
});

test('attach raises when the existing contact was itself already replaced away', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-attach-chain') });
  const targetEmail = `chain-target-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead Attach Chain',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `chain-old-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
        }),
        buildCampaignLead({
          key: 'target',
          email: targetEmail,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
        }),
      ],
    });

    const oldLead = graph.leadsByKey.get('old')!;
    const target = graph.leadsByKey.get('target')!;

    const firstReplacement = await loadReplacementResult(harness, {
      p_old_lead_id: target.leadId,
      p_new_email: `chain-onward-${harness.namespace}@furnace.test`,
    });
    assert.equal(firstReplacement.error, null, firstReplacement.error?.message);
    const firstRow = firstReplacement.data?.[0];
    assert.equal(firstRow?.mode, 'created');
    harness.recordReplacement({ replacementId: firstRow!.replacement_id, newLeadId: firstRow!.new_lead_id });

    // The create path soft-deletes the target, so revive it to reach the guard.
    const { error: reviveError } = await harness.supabase
      .from('leads')
      .update({ deleted_at: null } as any)
      .eq('id', target.leadId);
    assert.equal(reviveError, null, reviveError?.message);

    const attempt = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: targetEmail,
    });
    assert.match(attempt.error?.message ?? '', /has already been replaced by someone else/);
  } finally {
    await harness.cleanup();
  }
});

test('preview_replacement_target reports block-list hits by email and by domain', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-preview-block') });
  const blockedEmail = `blocked-${harness.namespace}@furnace.test`;
  const blockedDomain = `blocked-${harness.namespace}.test`;
  const blockedDomainEmail = `someone@${blockedDomain}`;
  const createdBlockIds: string[] = [];

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead Preview Block',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `block-old-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
        }),
      ],
    });
    const oldLead = graph.leadsByKey.get('old')!;

    const { data: blockRows, error: blockError } = await harness.supabase
      .from('block_list')
      .insert([
        { account_id: graph.accountId, type: 'email', value: blockedEmail, reason: 'unsubscribed' },
        { account_id: graph.accountId, type: 'domain', value: blockedDomain, reason: 'bounced' },
      ] as any)
      .select('id');
    assert.equal(blockError, null, blockError?.message);
    createdBlockIds.push(...(blockRows ?? []).map((row: any) => row.id));

    const previewEmail = await harness.supabase.rpc('preview_replacement_target', {
      p_account_id: graph.accountId,
      p_campaign_id: graph.campaignId,
      p_email: blockedEmail.toUpperCase(),
      p_old_lead_id: oldLead.leadId,
    });
    assert.equal(previewEmail.error, null, previewEmail.error?.message);
    assert.equal((previewEmail.data as any).blocked, true);
    assert.equal((previewEmail.data as any).blockReason, 'unsubscribed');
    assert.equal((previewEmail.data as any).existingLead, null);

    const previewDomain = await harness.supabase.rpc('preview_replacement_target', {
      p_account_id: graph.accountId,
      p_campaign_id: graph.campaignId,
      p_email: blockedDomainEmail,
      p_old_lead_id: oldLead.leadId,
    });
    assert.equal(previewDomain.error, null, previewDomain.error?.message);
    assert.equal((previewDomain.data as any).blocked, true);
    assert.equal((previewDomain.data as any).blockReason, 'bounced');

    const previewClean = await harness.supabase.rpc('preview_replacement_target', {
      p_account_id: graph.accountId,
      p_campaign_id: graph.campaignId,
      p_email: `clean-${harness.namespace}@furnace.test`,
      p_old_lead_id: oldLead.leadId,
    });
    assert.equal(previewClean.error, null, previewClean.error?.message);
    assert.equal((previewClean.data as any).blocked, false);
    assert.equal((previewClean.data as any).duplicateCount, 0);
  } finally {
    if (createdBlockIds.length > 0) {
      await harness.supabase.from('block_list').delete().in('id', createdBlockIds);
    }
    await harness.cleanup();
  }
});

test('a forward built from the repointed thread carries the target lead and enrollment', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('replaced-lead-attach-forward') });
  const now = Date.now();
  const targetEmail = `fwd-target-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Replaced Lead Attach Forward',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'old',
          email: `fwd-old-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
          jobs: [
            buildCampaignJob({ key: 'old-sent', status: 'sent', scheduledAt: new Date(now - 60 * 60 * 1000).toISOString(), sentAt: new Date(now - 59 * 60 * 1000).toISOString() }),
          ],
          thread: buildCampaignThread({
            subject: 'Forward source thread',
            lastMessageAt: new Date(now - 5 * 60 * 1000).toISOString(),
            messageJobKey: 'old-sent',
          }),
        }),
        buildCampaignLead({
          key: 'target',
          email: targetEmail,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({ state: 'active', currentFlowNodeId: 'email-1' }),
        }),
      ],
    });

    const oldLead = graph.leadsByKey.get('old')!;
    const target = graph.leadsByKey.get('target')!;
    const forwardedMessageId = await fetchReceivedMessageId(harness, oldLead.threadId!);

    const result = await loadReplacementResult(harness, {
      p_old_lead_id: oldLead.leadId,
      p_new_email: targetEmail,
    });
    assert.equal(result.error, null, result.error?.message);
    const rpcRow = result.data?.[0];
    assert.equal(rpcRow?.mode, 'attached');
    harness.recordReplacement({ replacementId: rpcRow!.replacement_id, newLeadId: rpcRow!.new_lead_id });

    const { data: forwardJobId, error: forwardError } = await harness.supabase.rpc(
      'create_inbox_forward_job',
      {
        p_account_id: graph.accountId,
        p_thread_id: oldLead.threadId!,
        p_forwarded_message_id: forwardedMessageId,
        p_subject: 'Fwd: intro',
        p_body_text: 'Forwarding for you.',
        p_body_html: '<p>Forwarding for you.</p>',
        p_to_email: targetEmail,
        p_to_name: null,
        p_cc: null,
        p_attachments: [],
      }
    );
    assert.equal(forwardError, null, forwardError?.message);
    assert.ok(forwardJobId);

    const { data: forwardJob, error: forwardJobError } = await harness.supabase
      .from('message_jobs')
      .select('lead_id, enrollment_id, campaign_id, message_type')
      .eq('id', forwardJobId as string)
      .single();
    assert.equal(forwardJobError, null, forwardJobError?.message);
    assert.equal(forwardJob?.message_type, 'inbox_forward');
    assert.equal(forwardJob?.lead_id, target.leadId);
    assert.equal(forwardJob?.enrollment_id, target.enrollmentId);
    assert.notEqual(forwardJob?.enrollment_id, oldLead.enrollmentId);

    await harness.supabase.from('message_jobs').delete().eq('id', forwardJobId as string);
  } finally {
    await harness.cleanup();
  }
});
