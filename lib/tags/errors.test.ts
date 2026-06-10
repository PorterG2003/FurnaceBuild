import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findTagByName,
  formatBulkMailboxTagConflictMessage,
  getTagCreateErrorMessage,
  getTagDuplicateNameMessage,
  getTagUpdateErrorMessage,
} from './errors';
import type { TagLike } from './types';

const tags: TagLike[] = [
  { id: '1', name: 'Sales', color: null },
  { id: '2', name: 'Support', color: '#fff' },
];

test('findTagByName matches case-insensitively and can exclude an id', () => {
  assert.equal(findTagByName(tags, 'sales')?.id, '1');
  assert.equal(findTagByName(tags, 'Sales', '1'), undefined);
  assert.equal(findTagByName(tags, 'Missing'), undefined);
});

test('getTagDuplicateNameMessage includes the attempted name', () => {
  assert.equal(getTagDuplicateNameMessage('Sales'), 'A tag named "Sales" already exists.');
});

test('getTagCreateErrorMessage maps duplicate name constraint errors', () => {
  const message = getTagCreateErrorMessage(
    {
      code: '23505',
      message: 'duplicate key value violates unique constraint "mailbox_tags_account_id_name_key"',
    },
    'Sales',
  );

  assert.equal(message, 'A tag named "Sales" already exists.');
});

test('getTagUpdateErrorMessage maps duplicate name constraint errors', () => {
  const message = getTagUpdateErrorMessage(
    {
      code: '23505',
      message: 'duplicate key value violates unique constraint "campaign_tags_account_id_name_key"',
    },
    'Support',
  );

  assert.equal(message, 'A tag named "Support" already exists.');
});

test('getTagCreateErrorMessage uses a generic fallback for unrelated errors', () => {
  const message = getTagCreateErrorMessage({
    code: '42501',
    message: 'permission denied for table mailbox_tags',
  });

  assert.equal(message, "Couldn't create tag. Try again.");
});

test('formatBulkMailboxTagConflictMessage resolves tag names', () => {
  assert.equal(
    formatBulkMailboxTagConflictMessage(['1'], tags),
    `Remove "Sales" from either the add or remove list — a tag can't be in both.`,
  );
  assert.equal(
    formatBulkMailboxTagConflictMessage(['1', '2'], tags),
    `"Sales" and "Support" are in both lists. Remove each from one list.`,
  );
});
