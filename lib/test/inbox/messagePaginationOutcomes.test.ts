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
import {
  mergeOlderMessagesPage,
  messageCursorFrom,
  type MessageCursor,
  type ThreadMessagesPage,
} from '../../inbox/messagePagination';
import type { EmailMessage } from '../../supabase/types';

const INBOX_MESSAGE_SELECT =
  'id, thread_id, account_id, message_job_id, direction, from_email, from_name, to_email, to_name, to_emails, cc, subject, body_text, body_html, received_at, read_at, attachments, imap_uid';

/** Same keyset page shape as production getMessagesByThreadPage, via harness client. */
async function fetchPage(
  harness: CampaignDbHarness,
  threadId: string,
  options: { limit: number; before?: MessageCursor | null },
): Promise<ThreadMessagesPage> {
  const limit = options.limit;
  const before = options.before ?? null;

  let query = harness.supabase
    .from('email_messages')
    .select(INBOX_MESSAGE_SELECT)
    .eq('thread_id', threadId)
    .order('received_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (before) {
    const receivedAt = `"${before.receivedAt.replace(/"/g, '\\"')}"`;
    const id = `"${before.id.replace(/"/g, '\\"')}"`;
    query = query.or(
      `received_at.lt.${receivedAt},and(received_at.eq.${receivedAt},id.lt.${id})`,
    );
  }

  const { data, error } = await query;
  assert.equal(error, null, error?.message);

  const rows = (data ?? []) as EmailMessage[];
  const hasOlder = rows.length > limit;
  const pageDesc = hasOlder ? rows.slice(0, limit) : rows;
  const messages = [...pageDesc].reverse();
  const oldest = messages[0] ?? null;
  const newest = messages[messages.length - 1] ?? null;

  return {
    messages,
    hasOlder,
    oldestCursor: oldest ? messageCursorFrom(oldest) : null,
    newestCursor: newest ? messageCursorFrom(newest) : null,
  };
}

test('message pagination returns newest page first, stable same-timestamp cursors, and reconstructs chronological history', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('msg-page'),
  });
  const now = Date.now();
  const pageSize = 10;
  const total = 25;

  try {
    const sameTimestamp = new Date(now - 20 * 60_000).toISOString();
    const messages = Array.from({ length: total }, (_, index) => {
      const isSameTimestampBatch = index >= 10 && index < 15;
      const receivedAt = isSameTimestampBatch
        ? sameTimestamp
        : new Date(now - (total - index) * 60_000).toISOString();
      return buildThreadMessage({
        direction: index % 2 === 0 ? 'sent' : 'received',
        receivedAt,
        readAt: index % 2 === 0 ? receivedAt : null,
        bodyText: `message-${index}`,
      });
    });

    const graph = await harness.createCampaignGraph({
      name: 'Message Pagination Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'paged',
          email: `paged-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: 'Long thread for pagination',
            lastMessageAt: new Date(now).toISOString(),
            messages,
          }),
        }),
      ],
    });

    const threadId = graph.leadsByKey.get('paged')?.threadId;
    assert.ok(threadId, 'expected seeded thread');

    const firstPage = await fetchPage(harness, threadId, { limit: pageSize });
    assert.equal(firstPage.messages.length, pageSize);
    assert.equal(firstPage.hasOlder, true);
    assert.ok(firstPage.oldestCursor);
    assert.ok(firstPage.newestCursor);

    for (let i = 1; i < firstPage.messages.length; i++) {
      const prev = firstPage.messages[i - 1]!;
      const curr = firstPage.messages[i]!;
      const prevKey = `${prev.received_at}:${prev.id}`;
      const currKey = `${curr.received_at}:${curr.id}`;
      assert.ok(prevKey <= currKey, `expected chronological order at ${i}`);
    }

    const { data: allRows, error: allError } = await harness.supabase
      .from('email_messages')
      .select('id, received_at, body_text')
      .eq('thread_id', threadId)
      .order('received_at', { ascending: true })
      .order('id', { ascending: true });
    assert.equal(allError, null, allError?.message);
    assert.equal((allRows ?? []).length, total);
    assert.equal(firstPage.messages[firstPage.messages.length - 1]?.id, allRows![total - 1]!.id);

    let loaded = firstPage.messages;
    let hasOlder = firstPage.hasOlder;
    let oldestCursor = firstPage.oldestCursor;
    const seen = new Set(loaded.map((m) => m.id));

    while (hasOlder && oldestCursor) {
      const older = await fetchPage(harness, threadId, {
        limit: pageSize,
        before: oldestCursor,
      });
      for (const message of older.messages) {
        assert.equal(seen.has(message.id), false, `duplicate message ${message.id}`);
        seen.add(message.id);
      }
      const merged = mergeOlderMessagesPage(loaded, older);
      loaded = merged.messages;
      hasOlder = merged.hasOlder;
      oldestCursor = merged.oldestCursor;
    }

    assert.equal(hasOlder, false);
    assert.equal(loaded.length, total);
    assert.deepEqual(
      loaded.map((m) => m.id),
      (allRows ?? []).map((row: { id: string }) => row.id),
    );

    const byReceivedAt = new Map<string, typeof loaded>();
    for (const message of loaded) {
      const group = byReceivedAt.get(message.received_at) ?? [];
      group.push(message);
      byReceivedAt.set(message.received_at, group);
    }
    const sameTsGroups = [...byReceivedAt.values()].filter((group) => group.length >= 2);
    assert.ok(
      sameTsGroups.length >= 1,
      `expected same-timestamp messages; got unique timestamps=${byReceivedAt.size}`,
    );
    for (const group of sameTsGroups) {
      for (let i = 1; i < group.length; i++) {
        assert.ok(
          group[i - 1]!.id < group[i]!.id,
          'same-timestamp messages must sort by id',
        );
      }
    }

    const mid = await fetchPage(harness, threadId, { limit: 5 });
    const before = messageCursorFrom(mid.messages[0]!);
    const next = await fetchPage(harness, threadId, { limit: 5, before });
    assert.equal(
      next.messages.some((m) => m.id === before.id),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});
