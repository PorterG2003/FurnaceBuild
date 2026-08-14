import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailMessage } from '../supabase/types';
import type { ThreadMessagesPage } from './messagePagination';
import {
  __getThreadMessagesInflightSizeForTests,
  __resetThreadMessagesCacheForTests,
  __setFetchPageForTests,
  getCachedThreadMessages,
  loadInitialThreadMessages,
  loadOlderThreadMessages,
  prefetchThreadMessages,
} from './threadMessagesCache';

function msg(id: string, receivedAt: string): EmailMessage {
  return {
    id,
    thread_id: 'thread-1',
    account_id: 'account-1',
    message_job_id: null,
    direction: 'received',
    from_email: 'a@example.com',
    from_name: null,
    to_email: 'b@example.com',
    to_name: null,
    to_emails: null,
    cc: null,
    subject: 'Subject',
    body_text: `body-${id}`,
    body_html: null,
    message_id: null,
    in_reply_to: null,
    message_references: null,
    reference_message_ids: null,
    thread_topic: null,
    thread_index: null,
    conversation_root_message_id: null,
    received_at: receivedAt,
    read_at: null,
    headers: {},
    attachments: [],
    imap_uid: null,
    parse_version: 1,
    search_vector: null,
    created_at: receivedAt,
    updated_at: receivedAt,
  };
}

function page(messages: EmailMessage[], hasOlder: boolean): ThreadMessagesPage {
  return {
    messages,
    hasOlder,
    oldestCursor: messages[0]
      ? { receivedAt: messages[0].received_at, id: messages[0].id }
      : null,
    newestCursor:
      messages.length > 0
        ? {
            receivedAt: messages[messages.length - 1]!.received_at,
            id: messages[messages.length - 1]!.id,
          }
        : null,
  };
}

test('threadMessagesCache dedupes in-flight initial loads and serves cache on revisit', async () => {
  __resetThreadMessagesCacheForTests();
  let calls = 0;
  let resolveFetch!: (value: ThreadMessagesPage) => void;
  const fetchPromise = new Promise<ThreadMessagesPage>((resolve) => {
    resolveFetch = resolve;
  });

  __setFetchPageForTests(async () => {
    calls += 1;
    return fetchPromise;
  });

  try {
    const first = loadInitialThreadMessages('account-1', 'thread-1');
    const second = loadInitialThreadMessages('account-1', 'thread-1');
    assert.equal(__getThreadMessagesInflightSizeForTests(), 1);

    resolveFetch(
      page(
        [msg('m1', '2026-01-01T00:00:00.000Z'), msg('m2', '2026-01-02T00:00:00.000Z')],
        false,
      ),
    );

    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.deepEqual(
      a.messages.map((m) => m.id),
      ['m1', 'm2'],
    );
    assert.deepEqual(
      b.messages.map((m) => m.id),
      ['m1', 'm2'],
    );

    const cached = getCachedThreadMessages('account-1', 'thread-1');
    assert.ok(cached);
    assert.equal(cached!.messages.length, 2);

    const revisited = await loadInitialThreadMessages('account-1', 'thread-1');
    assert.equal(calls, 1);
    assert.equal(revisited.messages.length, 2);
  } finally {
    __setFetchPageForTests(null);
    __resetThreadMessagesCacheForTests();
  }
});

test('threadMessagesCache prefetch is a no-op when already cached', async () => {
  __resetThreadMessagesCacheForTests();
  let calls = 0;
  __setFetchPageForTests(async () => {
    calls += 1;
    return page([msg('m1', '2026-01-01T00:00:00.000Z')], false);
  });

  try {
    await loadInitialThreadMessages('account-1', 'thread-1');
    prefetchThreadMessages('account-1', 'thread-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 1);
  } finally {
    __setFetchPageForTests(null);
    __resetThreadMessagesCacheForTests();
  }
});

test('threadMessagesCache loadOlder merges and updates cursors', async () => {
  __resetThreadMessagesCacheForTests();
  __setFetchPageForTests(async (_threadId, options) => {
    if (!options?.before) {
      return page(
        [msg('m3', '2026-01-03T00:00:00.000Z'), msg('m4', '2026-01-04T00:00:00.000Z')],
        true,
      );
    }
    return page(
      [msg('m1', '2026-01-01T00:00:00.000Z'), msg('m2', '2026-01-02T00:00:00.000Z')],
      false,
    );
  });

  try {
    await loadInitialThreadMessages('account-1', 'thread-1');
    const older = await loadOlderThreadMessages('account-1', 'thread-1', {
      receivedAt: '2026-01-03T00:00:00.000Z',
      id: 'm3',
    });
    assert.deepEqual(
      older.messages.map((m) => m.id),
      ['m1', 'm2', 'm3', 'm4'],
    );
    assert.equal(older.hasOlder, false);
    assert.deepEqual(getCachedThreadMessages('account-1', 'thread-1')?.messages.map((m) => m.id), [
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
  } finally {
    __setFetchPageForTests(null);
    __resetThreadMessagesCacheForTests();
  }
});

test('force refresh keeps older history already in cache', async () => {
  __resetThreadMessagesCacheForTests();
  let round = 0;
  __setFetchPageForTests(async (_threadId, options) => {
    round += 1;
    if (options?.before) {
      return page([msg('m1', '2026-01-01T00:00:00.000Z')], false);
    }
    if (round === 1) {
      return page([msg('m2', '2026-01-02T00:00:00.000Z')], true);
    }
    return page(
      [msg('m2', '2026-01-02T00:00:00.000Z'), msg('m3', '2026-01-03T00:00:00.000Z')],
      true,
    );
  });

  try {
    await loadInitialThreadMessages('account-1', 'thread-1');
    await loadOlderThreadMessages('account-1', 'thread-1', {
      receivedAt: '2026-01-02T00:00:00.000Z',
      id: 'm2',
    });
    const refreshed = await loadInitialThreadMessages('account-1', 'thread-1', { force: true });
    assert.deepEqual(
      refreshed.messages.map((m) => m.id),
      ['m1', 'm2', 'm3'],
    );
    assert.equal(refreshed.hasOlder, false);
  } finally {
    __setFetchPageForTests(null);
    __resetThreadMessagesCacheForTests();
  }
});
