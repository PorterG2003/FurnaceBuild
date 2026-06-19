import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  buildCampaignThread,
  createCampaignTestNamespace,
} from './fixtures';

test('OOO due processing resumes only due threads and leaves future rows untouched', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('ooo-outcomes') });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'OOO Outcomes',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'due',
          email: `due-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: null,
            stoppedReason: 'replied',
            stoppedAt: new Date(now - 60 * 60 * 1000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'campaign-pending',
              nodeFlowNodeId: 'email-2',
              status: 'queued',
              scheduledAt: new Date(now - 15 * 60 * 1000).toISOString(),
            }),
          ],
          thread: buildCampaignThread({
            subject: '[RESUME NOW] due thread',
            lastMessageAt: new Date(now - 5 * 60 * 1000).toISOString(),
            outOfOffice: true,
            oooResumeRequested: true,
            oooResumeAt: new Date(now - 60 * 1000).toISOString(),
            oooResumeProcessedAt: null,
            messageJobKey: 'campaign-pending',
          }),
        }),
        buildCampaignLead({
          key: 'future',
          email: `future-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-2',
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: null,
            stoppedReason: 'replied',
            stoppedAt: new Date(now - 60 * 60 * 1000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'campaign-pending',
              nodeFlowNodeId: 'email-2',
              status: 'reserved',
              scheduledAt: new Date(now + 60 * 60 * 1000).toISOString(),
            }),
          ],
          thread: buildCampaignThread({
            subject: '[RESUME LATER] future thread',
            lastMessageAt: new Date(now - 5 * 60 * 1000).toISOString(),
            outOfOffice: true,
            oooResumeRequested: true,
            oooResumeAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
            oooResumeProcessedAt: null,
            messageJobKey: 'campaign-pending',
          }),
        }),
      ],
    });

    const processed = await harness.supabase.rpc('process_due_out_of_office_resumes', {
      p_batch_size: 50,
    });
    assert.equal(processed.error, null);
    assert.ok(typeof processed.data === 'number' && processed.data >= 1);

    const due = graph.leadsByKey.get('due')!;
    const future = graph.leadsByKey.get('future')!;

    const { data: enrollmentRows, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('id, state, stopped_reason, next_run_at')
      .in('id', [due.enrollmentId!, future.enrollmentId!]);
    assert.equal(enrollmentError, null);
    const enrollmentById = new Map((enrollmentRows ?? []).map((row: any) => [row.id, row]));

    assert.equal(enrollmentById.get(due.enrollmentId!)?.state, 'active');
    assert.equal(enrollmentById.get(due.enrollmentId!)?.stopped_reason, null);
    assert.ok(enrollmentById.get(due.enrollmentId!)?.next_run_at);
    assert.equal(enrollmentById.get(future.enrollmentId!)?.state, 'stopped');
    assert.equal(enrollmentById.get(future.enrollmentId!)?.stopped_reason, 'replied');

    const { data: threadRows, error: threadError } = await harness.supabase
      .from('email_threads')
      .select('id, ooo_resume_requested, ooo_resume_processed_at')
      .in('id', [due.threadId!, future.threadId!]);
    assert.equal(threadError, null);
    const threadById = new Map((threadRows ?? []).map((row: any) => [row.id, row]));

    assert.equal(threadById.get(due.threadId!)?.ooo_resume_requested, false);
    assert.ok(threadById.get(due.threadId!)?.ooo_resume_processed_at);
    assert.equal(threadById.get(future.threadId!)?.ooo_resume_requested, true);
    assert.equal(threadById.get(future.threadId!)?.ooo_resume_processed_at, null);
  } finally {
    await harness.cleanup();
  }
});

test('OOO resume reschedules only future campaign work and leaves manual/history jobs untouched', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('ooo-reschedule') });
  const now = Date.now();
  const resumeAt = new Date(now - 60_000).toISOString();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'OOO Reschedule',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'reschedule',
          email: `reschedule-${harness.namespace}@furnace.test`,
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
              messageType: 'campaign',
              messageData: { source: 'campaign_seed' },
            }),
            buildCampaignJob({
              key: 'campaign-reserved',
              nodeFlowNodeId: 'email-2',
              status: 'reserved',
              scheduledAt: new Date(now + 5 * 60 * 1000).toISOString(),
              messageType: 'campaign',
              messageData: { source: 'campaign_seed' },
            }),
            buildCampaignJob({
              key: 'campaign-sent',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
              scheduledAt: new Date(now - 90 * 60 * 1000).toISOString(),
              sentAt: new Date(now - 89 * 60 * 1000).toISOString(),
              messageType: 'campaign',
              messageData: { source: 'campaign_seed' },
            }),
            buildCampaignJob({
              key: 'manual-reply',
              status: 'queued',
              scheduledAt: new Date(now - 10 * 60 * 1000).toISOString(),
              messageType: 'inbox_reply',
              messageData: { source: 'inbox_reply' },
            }),
            buildCampaignJob({
              key: 'manual-forward',
              status: 'reserved',
              scheduledAt: new Date(now - 10 * 60 * 1000).toISOString(),
              messageType: 'inbox_forward',
              messageData: { source: 'inbox_forward' },
            }),
          ],
          thread: buildCampaignThread({
            subject: '[RESUME NOW] OOO reschedule outcome',
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

    const lead = graph.leadsByKey.get('reschedule')!;
    const result = await harness.supabase.rpc('process_due_out_of_office_resumes', {
      p_batch_size: 50,
    });
    assert.equal(result.error, null);
    assert.ok(typeof result.data === 'number' && result.data >= 1);

    const ids = Array.from(lead.messageJobIdsByKey.values());
    const { data: jobs, error } = await harness.supabase
      .from('message_jobs')
      .select('id, status, scheduled_at, sent_at, message_type')
      .in('id', ids);
    assert.equal(error, null);
    const jobsById = new Map((jobs ?? []).map((row: any) => [row.id, row]));

    const pendingJob = jobsById.get(lead.messageJobIdsByKey.get('campaign-pending')!);
    const reservedJob = jobsById.get(lead.messageJobIdsByKey.get('campaign-reserved')!);
    const sentJob = jobsById.get(lead.messageJobIdsByKey.get('campaign-sent')!);
    const manualReply = jobsById.get(lead.messageJobIdsByKey.get('manual-reply')!);
    const manualForward = jobsById.get(lead.messageJobIdsByKey.get('manual-forward')!);

    const floor = Date.parse(resumeAt) + 30_000;
    assert.ok(Date.parse(pendingJob.scheduled_at) >= floor);
    assert.ok(Date.parse(reservedJob.scheduled_at) >= floor);
    assert.equal(sentJob.sent_at != null, true);
    assert.equal(
      Date.parse(sentJob.scheduled_at),
      Date.parse(new Date(now - 90 * 60 * 1000).toISOString()),
    );
    assert.equal(
      Date.parse(manualReply.scheduled_at),
      Date.parse(new Date(now - 10 * 60 * 1000).toISOString()),
    );
    assert.equal(
      Date.parse(manualForward.scheduled_at),
      Date.parse(new Date(now - 10 * 60 * 1000).toISOString()),
    );
  } finally {
    await harness.cleanup();
  }
});

test('only stopped/replied threads can be scheduled for OOO resume through the public RPC', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('ooo-resumability') });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'OOO Resumability',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'resumable',
          email: `resumable-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: null,
            stoppedReason: 'replied',
            stoppedAt: new Date(now - 30 * 60 * 1000).toISOString(),
          }),
          thread: buildCampaignThread({
            subject: '[OOO] resumable',
            lastMessageAt: new Date(now - 10 * 60 * 1000).toISOString(),
            outOfOffice: false,
            oooResumeRequested: false,
            oooResumeAt: null,
            oooResumeProcessedAt: null,
          }),
        }),
        buildCampaignLead({
          key: 'non-resumable',
          email: `non-resumable-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-2',
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: null,
            stoppedReason: 'bounced',
            stoppedAt: new Date(now - 30 * 60 * 1000).toISOString(),
          }),
          thread: buildCampaignThread({
            subject: '[OOO] non-resumable',
            lastMessageAt: new Date(now - 10 * 60 * 1000).toISOString(),
            outOfOffice: false,
            oooResumeRequested: false,
            oooResumeAt: null,
            oooResumeProcessedAt: null,
          }),
        }),
      ],
    });

    const resumable = graph.leadsByKey.get('resumable')!;
    const nonResumable = graph.leadsByKey.get('non-resumable')!;

    const ok = await harness.supabase.rpc('mark_email_thread_out_of_office', {
      p_thread_id: resumable.threadId!,
      p_out_of_office: true,
      p_resume_requested: true,
      p_resume_at: new Date(now + 60 * 60 * 1000).toISOString(),
    });
    assert.equal(ok.error, null);

    const failed = await harness.supabase.rpc('mark_email_thread_out_of_office', {
      p_thread_id: nonResumable.threadId!,
      p_out_of_office: true,
      p_resume_requested: true,
      p_resume_at: new Date(now + 60 * 60 * 1000).toISOString(),
    });
    assert.match(failed.error?.message ?? '', /Enrollment is not in a resumable state/);

    const { data: threadRows, error: threadError } = await harness.supabase
      .from('email_threads')
      .select('id, out_of_office, ooo_resume_requested')
      .in('id', [resumable.threadId!, nonResumable.threadId!]);
    assert.equal(threadError, null);
    const rowsById = new Map((threadRows ?? []).map((row: any) => [row.id, row]));

    assert.equal(rowsById.get(resumable.threadId!)?.out_of_office, true);
    assert.equal(rowsById.get(resumable.threadId!)?.ooo_resume_requested, true);
    assert.equal(rowsById.get(nonResumable.threadId!)?.out_of_office, false);
    assert.equal(rowsById.get(nonResumable.threadId!)?.ooo_resume_requested, false);
  } finally {
    await harness.cleanup();
  }
});

test('schedule_thread_ooo_resume unifies stopped and non-resumable legacy threads without throwing', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('ooo-facade-legacy') });
  const now = Date.now();

  try {
    const probe = await harness.supabase.rpc('schedule_thread_ooo_resume', {
      p_thread_id: '00000000-0000-4000-8000-000000000000',
      p_resume_at: new Date(now).toISOString(),
      p_return_date: null,
      p_mark_auto_reply: true,
    });
    if (probe.error?.code === 'PGRST202') {
      return;
    }

    const graph = await harness.createCampaignGraph({
      name: 'OOO Facade Legacy',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'resumable',
          email: `facade-resumable-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: null,
            stoppedReason: 'replied',
            stoppedAt: new Date(now - 30 * 60 * 1000).toISOString(),
          }),
          thread: buildCampaignThread({
            subject: '[OOO FACADE] resumable',
            lastMessageAt: new Date(now - 10 * 60 * 1000).toISOString(),
          }),
        }),
        buildCampaignLead({
          key: 'non-resumable',
          email: `facade-non-resumable-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-2',
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: null,
            stoppedReason: 'bounced',
            stoppedAt: new Date(now - 30 * 60 * 1000).toISOString(),
          }),
          thread: buildCampaignThread({
            subject: '[OOO FACADE] non-resumable',
            lastMessageAt: new Date(now - 10 * 60 * 1000).toISOString(),
          }),
        }),
        buildCampaignLead({
          key: 'mark-only',
          email: `facade-mark-only-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-3',
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: null,
            stoppedReason: 'bounced',
            stoppedAt: new Date(now - 30 * 60 * 1000).toISOString(),
          }),
          thread: buildCampaignThread({
            subject: '[OOO FACADE] mark-only',
            lastMessageAt: new Date(now - 10 * 60 * 1000).toISOString(),
          }),
        }),
      ],
    });

    const resumeAt = new Date(now + 2 * 60 * 60 * 1000).toISOString();
    const resumable = graph.leadsByKey.get('resumable')!;
    const nonResumable = graph.leadsByKey.get('non-resumable')!;
    const markOnly = graph.leadsByKey.get('mark-only')!;

    const { data: resumableResult, error: resumableError } = await harness.supabase.rpc(
      'schedule_thread_ooo_resume',
      {
        p_thread_id: resumable.threadId!,
        p_resume_at: resumeAt,
        p_return_date: resumeAt.slice(0, 10),
        p_mark_auto_reply: true,
      }
    );
    assert.equal(resumableError, null);
    assert.equal(resumableResult, 'scheduled_stopped');

    const { data: nonResumableResult, error: nonResumableError } = await harness.supabase.rpc(
      'schedule_thread_ooo_resume',
      {
        p_thread_id: nonResumable.threadId!,
        p_resume_at: resumeAt,
        p_return_date: resumeAt.slice(0, 10),
        p_mark_auto_reply: true,
      }
    );
    assert.equal(nonResumableError, null);
    assert.equal(nonResumableResult, 'no_resumable_execution_state');

    const { data: markOnlyResult, error: markOnlyError } = await harness.supabase.rpc(
      'schedule_thread_ooo_resume',
      {
        p_thread_id: markOnly.threadId!,
        p_resume_at: null,
        p_return_date: null,
        p_mark_auto_reply: true,
      }
    );
    assert.equal(markOnlyError, null);
    assert.equal(markOnlyResult, 'marked_only');

    const { data: threadRows, error: threadError } = await harness.supabase
      .from('email_threads')
      .select('id, category, out_of_office, ooo_resume_requested, ooo_resume_at')
      .in('id', [resumable.threadId!, nonResumable.threadId!, markOnly.threadId!]);
    assert.equal(threadError, null);
    const rowsById = new Map((threadRows ?? []).map((row: any) => [row.id, row]));

    assert.equal(rowsById.get(resumable.threadId!)?.category, 'Auto Reply');
    assert.equal(rowsById.get(resumable.threadId!)?.out_of_office, true);
    assert.equal(rowsById.get(resumable.threadId!)?.ooo_resume_requested, true);
    assert.equal(rowsById.get(resumable.threadId!)?.ooo_resume_at, resumeAt);

    assert.equal(rowsById.get(nonResumable.threadId!)?.category, 'Auto Reply');
    assert.equal(rowsById.get(nonResumable.threadId!)?.out_of_office, true);
    assert.equal(rowsById.get(nonResumable.threadId!)?.ooo_resume_requested, false);
    assert.equal(rowsById.get(nonResumable.threadId!)?.ooo_resume_at, null);

    assert.equal(rowsById.get(markOnly.threadId!)?.category, 'Auto Reply');
    assert.equal(rowsById.get(markOnly.threadId!)?.out_of_office, true);
    assert.equal(rowsById.get(markOnly.threadId!)?.ooo_resume_requested, false);
    assert.equal(rowsById.get(markOnly.threadId!)?.ooo_resume_at, null);
  } finally {
    await harness.cleanup();
  }
});
