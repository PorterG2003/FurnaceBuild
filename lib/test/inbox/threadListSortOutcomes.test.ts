import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignDbHarness } from '../campaign/harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  buildCampaignThread,
  buildThreadMessage,
  createCampaignTestNamespace,
} from '../campaign/fixtures';

async function ensureInboxSortSchema(
  harness: CampaignDbHarness,
  t: test.TestContext,
): Promise<boolean> {
  const { error } = await harness.supabase.rpc('list_account_inbox_threads', {
    p_account_id: '00000000-0000-4000-8000-000000000000',
    p_limit: 1,
    p_offset: 0,
    p_sort: 'newest',
  });
  if (error && /Could not find the function|does not exist|schema cache|p_sort/i.test(error.message)) {
    t.skip(`Inbox list sort RPC not applied in shared test DB: ${error.message}`);
    return false;
  }
  return true;
}

async function listSubjects(
  harness: CampaignDbHarness,
  accountId: string,
  sort: 'open_first' | 'newest' | 'oldest' | 'unread_first',
): Promise<string[]> {
  const { data, error } = await harness.supabase.rpc('list_account_inbox_threads', {
    p_account_id: accountId,
    p_has_reply_only: true,
    p_limit: 20,
    p_offset: 0,
    p_sort: sort,
  });
  assert.equal(error, null, error?.message);
  return ((data ?? []) as Array<{ subject: string }>).map((row) => row.subject);
}

test('list_account_inbox_threads honors open_first, newest, oldest, and unread_first sorts', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('thread-list-sort'),
  });
  const now = Date.now();

  try {
    if (!(await ensureInboxSortSchema(harness, t))) return;

    const graph = await harness.createCampaignGraph({
      name: 'Thread List Sort Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'open-older',
          email: `open-older-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: 'Open older',
            lastMessageAt: new Date(now - 30 * 60_000).toISOString(),
            messages: [
              buildThreadMessage({
                direction: 'received',
                receivedAt: new Date(now - 30 * 60_000).toISOString(),
                readAt: new Date(now - 29 * 60_000).toISOString(),
              }),
            ],
          }),
        }),
        buildCampaignLead({
          key: 'closed-newest',
          email: `closed-newest-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: 'Closed newest',
            lastMessageAt: new Date(now - 5 * 60_000).toISOString(),
            messages: [
              buildThreadMessage({
                direction: 'received',
                receivedAt: new Date(now - 5 * 60_000).toISOString(),
                readAt: new Date(now - 4 * 60_000).toISOString(),
              }),
            ],
          }),
        }),
        buildCampaignLead({
          key: 'open-unread',
          email: `open-unread-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: 'Open unread mid',
            lastMessageAt: new Date(now - 15 * 60_000).toISOString(),
            messages: [
              buildThreadMessage({
                direction: 'received',
                receivedAt: new Date(now - 15 * 60_000).toISOString(),
                readAt: null,
              }),
            ],
          }),
        }),
      ],
    });

    const openOlderId = graph.leadsByKey.get('open-older')!.threadId!;
    const closedNewestId = graph.leadsByKey.get('closed-newest')!.threadId!;
    const openUnreadId = graph.leadsByKey.get('open-unread')!.threadId!;

    const { error: openOlderErr } = await harness.supabase
      .from('email_threads')
      .update({ conversation_status: 'open', has_reply: true })
      .eq('id', openOlderId);
    assert.equal(openOlderErr, null);

    const { error: closedErr } = await harness.supabase
      .from('email_threads')
      .update({
        conversation_status: 'closed',
        conversation_status_source: 'user',
        has_reply: true,
      })
      .eq('id', closedNewestId);
    assert.equal(closedErr, null);

    const { error: openUnreadErr } = await harness.supabase
      .from('email_threads')
      .update({ conversation_status: 'open', has_reply: true })
      .eq('id', openUnreadId);
    assert.equal(openUnreadErr, null);

    const accountId = graph.accountId;

    assert.deepEqual(await listSubjects(harness, accountId, 'open_first'), [
      'Open unread mid',
      'Open older',
      'Closed newest',
    ]);

    assert.deepEqual(await listSubjects(harness, accountId, 'newest'), [
      'Closed newest',
      'Open unread mid',
      'Open older',
    ]);

    assert.deepEqual(await listSubjects(harness, accountId, 'oldest'), [
      'Open older',
      'Open unread mid',
      'Closed newest',
    ]);

    assert.deepEqual(await listSubjects(harness, accountId, 'unread_first'), [
      'Open unread mid',
      'Closed newest',
      'Open older',
    ]);
  } finally {
    await harness.cleanup();
  }
});
