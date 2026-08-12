import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseApiBulkExclusions,
  parseApiBulkScope,
  scopeFromLegacyJobFields,
} from './scope.js';

test('parseApiBulkScope accepts saved_list and campaign scopes', () => {
  assert.deepEqual(parseApiBulkScope({ kind: 'saved_list', list_id: 'list-1' }), {
    kind: 'saved_list',
    list_id: 'list-1',
  });
  assert.deepEqual(parseApiBulkScope({ kind: 'campaign', campaign_id: 'camp-1' }), {
    kind: 'campaign',
    campaign_id: 'camp-1',
  });
});

test('parseApiBulkScope rejects empty selection', () => {
  assert.equal(parseApiBulkScope({ kind: 'selection', global_lead_ids: [] }), null);
});

test('parseApiBulkExclusions normalizes emails', () => {
  assert.deepEqual(
    parseApiBulkExclusions({
      emails: ['A@Example.com', 'a@example.com', ''],
      list_id: 'list-x',
    }),
    {
      emails: ['a@example.com'],
      list_id: 'list-x',
    },
  );
});

test('scopeFromLegacyJobFields prefers list_id then selection', () => {
  assert.deepEqual(scopeFromLegacyJobFields({ list_id: 'abc', global_lead_ids: ['1'] }), {
    kind: 'saved_list',
    list_id: 'abc',
  });
  assert.deepEqual(scopeFromLegacyJobFields({ global_lead_ids: ['1', '1'] }), {
    kind: 'selection',
    global_lead_ids: ['1'],
  });
});
