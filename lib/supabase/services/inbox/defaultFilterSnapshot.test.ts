import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inboxFiltersEqual,
  parseInboxDefaultFilter,
  toInboxFilterSnapshot,
  type InboxDefaultFilterSnapshot,
} from './defaultFilterSnapshot';

const SAMPLE: InboxDefaultFilterSnapshot = {
  mailboxFilterId: 'mb-1',
  campaignFilterId: null,
  unreadOnlyFilter: true,
  datePreset: '7d',
  tagFilterIds: ['b', 'a'],
  campaignTagFilterIds: [],
  categoryFilter: '__no_category__',
  conversationStatusFilter: 'open',
  sortBy: 'unread_first',
};

test('parseInboxDefaultFilter accepts a valid snapshot', () => {
  assert.deepEqual(parseInboxDefaultFilter(SAMPLE), SAMPLE);
});

test('parseInboxDefaultFilter rejects invalid snapshots', () => {
  assert.equal(parseInboxDefaultFilter(null), null);
  assert.equal(parseInboxDefaultFilter({}), null);
  assert.equal(parseInboxDefaultFilter({ ...SAMPLE, datePreset: '90d' }), null);
  assert.equal(parseInboxDefaultFilter({ ...SAMPLE, sortBy: 'priority' }), null);
  assert.equal(parseInboxDefaultFilter({ ...SAMPLE, tagFilterIds: ['ok', 1] }), null);
  assert.equal(parseInboxDefaultFilter({ ...SAMPLE, mailboxFilterId: '' }), null);
});

test('inboxFiltersEqual treats tag order as irrelevant', () => {
  const a = toInboxFilterSnapshot(SAMPLE);
  const b = toInboxFilterSnapshot({ ...SAMPLE, tagFilterIds: ['a', 'b'] });
  assert.equal(inboxFiltersEqual(a, b), true);
  assert.equal(inboxFiltersEqual(a, { ...b, unreadOnlyFilter: false }), false);
});
