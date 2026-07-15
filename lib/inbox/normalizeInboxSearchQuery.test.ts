import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INBOX_SEARCH_MIN_CHARS,
  normalizeInboxSearchQuery,
} from './normalizeInboxSearchQuery';

test('normalizeInboxSearchQuery trims and enforces min length', () => {
  assert.equal(INBOX_SEARCH_MIN_CHARS, 2);
  assert.equal(normalizeInboxSearchQuery(null), null);
  assert.equal(normalizeInboxSearchQuery(''), null);
  assert.equal(normalizeInboxSearchQuery('  '), null);
  assert.equal(normalizeInboxSearchQuery('a'), null);
  assert.equal(normalizeInboxSearchQuery(' ab '), 'ab');
  assert.equal(normalizeInboxSearchQuery('Acme Corp'), 'Acme Corp');
});
