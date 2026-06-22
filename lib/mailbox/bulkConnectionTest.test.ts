import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConnectionTestFailure,
  runBulkMailboxConnectionTests,
} from './bulkConnectionTest.ts';

function createItem(key: string) {
  return {
    key,
    input: { id: key },
    params: {
      smtp_host: `${key}.smtp.example.com`,
      smtp_port: 587,
      smtp_username: `${key}-smtp`,
      smtp_password: 'secret',
      smtp_use_tls: true,
      smtp_use_ssl: false,
      imap_host: `${key}.imap.example.com`,
      imap_port: 993,
      imap_username: `${key}-imap`,
      imap_password: 'secret',
      imap_use_ssl: true,
    },
  };
}

test('runBulkMailboxConnectionTests runs sequentially and reports progress', async () => {
  const items = [createItem('a'), createItem('b'), createItem('c')];
  const started: string[] = [];
  const completed: string[] = [];
  const progress: string[] = [];

  const outcomes = await runBulkMailboxConnectionTests({
    items,
    testFn: async (item) => {
      started.push(item.key);
      await Promise.resolve();
      completed.push(item.key);
      return {
        success: true,
        message: 'ok',
        smtp: { success: true },
        imap: { success: true },
      };
    },
    onProgress: ({ item, status }) => {
      progress.push(`${item.key}:${status}`);
    },
  });

  assert.deepEqual(started, ['a', 'b', 'c']);
  assert.deepEqual(completed, ['a', 'b', 'c']);
  assert.deepEqual(progress, [
    'a:testing',
    'a:done',
    'b:testing',
    'b:done',
    'c:testing',
    'c:done',
  ]);
  assert.equal(outcomes.length, 3);
});

test('runBulkMailboxConnectionTests stops when aborted between items', async () => {
  const items = [createItem('a'), createItem('b'), createItem('c')];
  const controller = new AbortController();
  const started: string[] = [];

  const outcomes = await runBulkMailboxConnectionTests({
    items,
    signal: controller.signal,
    testFn: async (item) => {
      started.push(item.key);
      controller.abort();
      return {
        success: true,
        message: 'ok',
        smtp: { success: true },
        imap: { success: true },
      };
    },
  });

  assert.deepEqual(started, ['a']);
  assert.equal(outcomes.length, 1);
});

test('buildConnectionTestFailure marks both protocols failed with one message', () => {
  assert.deepEqual(buildConnectionTestFailure('Failed to test mailbox connection'), {
    success: false,
    smtp: { success: false, error: 'Failed to test mailbox connection' },
    imap: { success: false, error: 'Failed to test mailbox connection' },
    message: 'Failed to test mailbox connection',
  });
});
