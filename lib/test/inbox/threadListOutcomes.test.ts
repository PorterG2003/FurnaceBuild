import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignDbHarness } from '../campaign/harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  buildCampaignThread,
  buildThreadMessage,
  createCampaignTestNamespace,
} from '../campaign/fixtures';
import { buildProcessedReply } from '../campaign/categorizer-helpers';
import { ThreadManager } from '../../../workers/inbox-checker-worker/src/thread-manager';

async function ensureInboxRedesignSchema(
  harness: CampaignDbHarness,
  t: test.TestContext,
): Promise<boolean> {
  const { error } = await harness.supabase
    .from('email_threads')
    .select('conversation_status')
    .limit(1);
  if (error) {
    t.skip(`Inbox redesign schema not applied in shared test DB: ${error.message}`);
    return false;
  }
  return true;
}

async function getMailbox(harness: CampaignDbHarness, mailboxId: string) {
  const { data, error } = await harness.supabase
    .from('mailboxes')
    .select('*')
    .eq('id', mailboxId)
    .single();
  assert.equal(error, null);
  return data as any;
}

async function listThreadSubjects(
  harness: CampaignDbHarness,
  threadIds: string[],
  conversationStatus: 'open' | 'closed' | 'all',
): Promise<string[]> {
  let query = harness.supabase
    .from('email_threads')
    .select('subject, conversation_status, last_message_at')
    .in('id', threadIds)
    .eq('has_reply', true)
    .order('conversation_status', { ascending: false })
    .order('last_message_at', { ascending: false });

  if (conversationStatus !== 'all') {
    query = query.eq('conversation_status', conversationStatus);
  }

  const { data, error } = await query;
  assert.equal(error, null);
  return (data ?? []).map((row: any) => row.subject);
}

test('thread list prefers open conversations, filters by open/closed/all, and still includes Auto Reply threads', async (t) => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('thread-list') });
  const now = Date.now();

  try {
    if (!(await ensureInboxRedesignSchema(harness, t))) return;
    const graph = await harness.createCampaignGraph({
      name: 'Thread List Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'open-new',
          email: `open-new-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: 'Newest open thread',
            lastMessageAt: new Date(now - 5 * 60_000).toISOString(),
          }),
        }),
        buildCampaignLead({
          key: 'closed-newer',
          email: `closed-newer-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-2',
          enrollment: buildCampaignEnrollment(),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              status: 'sent',
              providerMessageId: `<orig-${harness.namespace}@furnace.test>`,
              scheduledAt: new Date(now - 10 * 60_000).toISOString(),
              sentAt: new Date(now - 10 * 60_000).toISOString(),
            }),
          ],
          thread: buildCampaignThread({
            subject: 'Closed but newer thread',
            lastMessageAt: new Date(now - 2 * 60_000).toISOString(),
            messageJobKey: 'sent-1',
            messages: [
              buildThreadMessage({
                direction: 'sent',
                messageId: `<orig-${harness.namespace}@furnace.test>`,
                receivedAt: new Date(now - 10 * 60_000).toISOString(),
                readAt: new Date(now - 10 * 60_000).toISOString(),
              }),
            ],
          }),
        }),
        buildCampaignLead({
          key: 'auto-reply',
          email: `auto-reply-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: 'Auto Reply thread',
            lastMessageAt: new Date(now - 20 * 60_000).toISOString(),
            outOfOffice: true,
          }),
        }),
      ],
    });

    const openNewThreadId = graph.leadsByKey.get('open-new')!.threadId!;
    const closedNewerThreadId = graph.leadsByKey.get('closed-newer')!.threadId!;
    const autoReplyThreadId = graph.leadsByKey.get('auto-reply')!.threadId!;
    const { error: openUpdateError } = await harness.supabase
      .from('email_threads')
      .update({ conversation_status: 'open' })
      .eq('id', openNewThreadId);
    assert.equal(openUpdateError, null);
    const { error: closedUpdateError } = await harness.supabase
      .from('email_threads')
      .update({
        conversation_status: 'closed',
        conversation_status_source: 'user',
      })
      .eq('id', closedNewerThreadId);
    assert.equal(closedUpdateError, null);
    const { error: autoReplyUpdateError } = await harness.supabase
      .from('email_threads')
      .update({
        conversation_status: 'closed',
        conversation_status_source: 'system',
        category: 'Auto Reply',
        category_source: 'system',
      })
      .eq('id', autoReplyThreadId);
    assert.equal(autoReplyUpdateError, null);

    const threadIds = graph.manifest.threadIds;
    const allSubjects = await listThreadSubjects(harness, threadIds, 'all');
    assert.deepEqual(allSubjects, [
      'Newest open thread',
      'Closed but newer thread',
      'Auto Reply thread',
    ]);

    const openSubjects = await listThreadSubjects(harness, threadIds, 'open');
    assert.deepEqual(openSubjects, ['Newest open thread']);

    const closedSubjects = await listThreadSubjects(harness, threadIds, 'closed');
    assert.deepEqual(closedSubjects, ['Closed but newer thread', 'Auto Reply thread']);

    const lead = graph.leadsByKey.get('closed-newer')!;
    const sentJobId = lead.messageJobIdsByKey.get('sent-1')!;
    const { data: sentJob } = await harness.supabase
      .from('message_jobs')
      .select('provider_message_id, mailbox_id')
      .eq('id', sentJobId)
      .single();
    assert.ok(sentJob?.provider_message_id);

    const mailbox = await getMailbox(harness, sentJob!.mailbox_id);
    const threadManager = new ThreadManager(harness.supabase as any);
    const handled = await threadManager.handleReply(
      mailbox,
      buildProcessedReply({
        leadEmail: `closed-newer-${harness.namespace}@furnace.test`,
        mailboxEmail: graph.mailboxEmailsByKey.get('mailbox-2')!,
        inReplyTo: sentJob!.provider_message_id,
        bodyText: 'Reopening this conversation.',
      }),
    );
    assert.equal(handled, true);

    const reopenedSubjects = await listThreadSubjects(harness, threadIds, 'all');
    assert.equal(reopenedSubjects[0], 'Closed but newer thread');

    const { data: reopenedThread } = await harness.supabase
      .from('email_threads')
      .select('conversation_status')
      .eq('id', lead.threadId!)
      .single();
    assert.equal(reopenedThread?.conversation_status, 'open');
  } finally {
    await harness.cleanup();
  }
});
