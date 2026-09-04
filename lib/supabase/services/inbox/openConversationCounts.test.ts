import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadOpenConversationCountsByAccountIds,
  OPEN_CONVERSATION_COUNT_FILTERS,
} from './openConversationCounts-core';

test('OPEN_CONVERSATION_COUNT_FILTERS matches the inbox list (open + has_reply)', () => {
  assert.equal(OPEN_CONVERSATION_COUNT_FILTERS.conversationStatus, 'open');
  assert.equal(OPEN_CONVERSATION_COUNT_FILTERS.hasReply, true);
  assert.equal(OPEN_CONVERSATION_COUNT_FILTERS.countColumn, 'id');
});

test('loadOpenConversationCountsByAccountIds returns empty record for no account ids', async () => {
  const fetchCount = async () => {
    throw new Error('should not be called');
  };
  const result = await loadOpenConversationCountsByAccountIds([], fetchCount);
  assert.deepEqual(result, {});
});

test('loadOpenConversationCountsByAccountIds maps parallel account counts', async () => {
  const countsByAccount: Record<string, number> = {
    'account-a': 2,
    'account-b': 0,
    'account-c': 7,
  };

  const result = await loadOpenConversationCountsByAccountIds(
    ['account-a', 'account-b', 'account-c'],
    async (accountId) => countsByAccount[accountId] ?? 0,
  );

  assert.deepEqual(result, countsByAccount);
});
