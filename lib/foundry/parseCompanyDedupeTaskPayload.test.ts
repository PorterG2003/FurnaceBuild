import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCompanyDedupeTaskPayload } from './registry-types.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

test('parseCompanyDedupeTaskPayload ready when two+ candidate ids', () => {
  const r = parseCompanyDedupeTaskPayload({
    candidate_company_ids: [A, B],
    normalized_key: 'acme',
  });
  assert.deepEqual(r, {
    status: 'ready',
    candidateIds: [A, B],
    normalizedKey: 'acme',
  });
});

test('parseCompanyDedupeTaskPayload dedupes ids', () => {
  const r = parseCompanyDedupeTaskPayload({
    candidate_company_ids: [A, B, A],
  });
  assert.equal(r.status, 'ready');
  if (r.status === 'ready') assert.deepEqual(r.candidateIds, [A, B]);
});

test('parseCompanyDedupeTaskPayload needs_fetch_by_key when only normalized_key', () => {
  const r = parseCompanyDedupeTaskPayload({ normalized_key: 'foo' });
  assert.deepEqual(r, { status: 'needs_fetch_by_key', normalizedKey: 'foo' });
});

test('parseCompanyDedupeTaskPayload needs_company_hint for legacy company_id', () => {
  const r = parseCompanyDedupeTaskPayload({ company_id: A });
  assert.deepEqual(r, { status: 'needs_company_hint', companyId: A });
});

test('parseCompanyDedupeTaskPayload invalid for empty', () => {
  assert.equal(parseCompanyDedupeTaskPayload({}).status, 'invalid');
  assert.equal(parseCompanyDedupeTaskPayload(undefined).status, 'invalid');
});
