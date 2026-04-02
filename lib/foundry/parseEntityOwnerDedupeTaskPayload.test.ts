import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEntityOwnerDedupeTaskPayload } from './registry-types.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('parseEntityOwnerDedupeTaskPayload ready with two+ ids', () => {
  const r = parseEntityOwnerDedupeTaskPayload({
    candidate_entity_owner_ids: [A, B],
    state_entity_id: SE,
    owner_normalized_key: 'john_doe',
  });
  assert.equal(r.status, 'ready');
  if (r.status === 'ready') {
    assert.deepEqual(r.candidateIds, [A, B]);
    assert.equal(r.stateEntityId, SE);
    assert.equal(r.ownerNormalizedKey, 'john_doe');
  }
});

test('parseEntityOwnerDedupeTaskPayload needs_cluster_fetch', () => {
  const r = parseEntityOwnerDedupeTaskPayload({
    state_entity_id: SE,
    owner_normalized_key: 'foo',
  });
  assert.deepEqual(r, {
    status: 'needs_cluster_fetch',
    stateEntityId: SE,
    ownerNormalizedKey: 'foo',
  });
});

test('parseEntityOwnerDedupeTaskPayload invalid', () => {
  assert.equal(parseEntityOwnerDedupeTaskPayload({}).status, 'invalid');
});
