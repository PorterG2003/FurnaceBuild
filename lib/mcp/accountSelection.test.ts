import assert from 'node:assert/strict';
import test from 'node:test';
import {
  injectAccountIdIntoInputSchema,
  resolveAccountSelection,
} from './accountSelection.js';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const UNKNOWN = '33333333-3333-4333-8333-333333333333';

test('single granted account defaults when account_id omitted', () => {
  const result = resolveAccountSelection({
    args: { name: 'Campaign' },
    allowedAccountIds: [ACCOUNT_A],
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected success');
  assert.equal(result.accountId, ACCOUNT_A);
  assert.deepEqual(result.forwardedArgs, { name: 'Campaign' });
  assert.equal('account_id' in result.forwardedArgs, false);
});

test('multiple granted + omitted account_id returns error listing options', () => {
  const result = resolveAccountSelection({
    args: { foo: 1 },
    allowedAccountIds: [ACCOUNT_A, ACCOUNT_B],
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.match(result.message, /account_id is required/i);
  assert.match(result.message, new RegExp(ACCOUNT_A));
  assert.match(result.message, new RegExp(ACCOUNT_B));
  assert.match(result.message, /listAccounts/i);
});

test('ungranted, unknown, and malformed account_id are rejected', () => {
  const ungranted = resolveAccountSelection({
    args: { account_id: UNKNOWN },
    allowedAccountIds: [ACCOUNT_A],
  });
  assert.equal(ungranted.ok, false);
  if (ungranted.ok) throw new Error('expected failure');
  assert.match(ungranted.message, /not in this session's grant/i);

  const malformed = resolveAccountSelection({
    args: { account_id: 'not-a-uuid' },
    allowedAccountIds: [ACCOUNT_A],
  });
  assert.equal(malformed.ok, false);
  if (malformed.ok) throw new Error('expected failure');
  assert.match(malformed.message, /valid UUID/i);

  const wrongType = resolveAccountSelection({
    args: { account_id: 123 as unknown as string },
    allowedAccountIds: [ACCOUNT_A],
  });
  assert.equal(wrongType.ok, false);
  if (wrongType.ok) throw new Error('expected failure');
  assert.match(wrongType.message, /must be a string UUID/i);
});

test('account_id is stripped from forwardedArgs on success', () => {
  const result = resolveAccountSelection({
    args: { account_id: ACCOUNT_A, name: 'Hello', extra: true },
    allowedAccountIds: [ACCOUNT_A, ACCOUNT_B],
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected success');
  assert.equal(result.accountId, ACCOUNT_A);
  assert.deepEqual(result.forwardedArgs, { name: 'Hello', extra: true });
  assert.equal('account_id' in result.forwardedArgs, false);
});

test('injectAccountIdIntoInputSchema adds account_id without clobbering existing properties', () => {
  const schema = injectAccountIdIntoInputSchema({
    type: 'object',
    properties: {
      name: { type: 'string' },
      account_id: { type: 'string', description: 'keep me' },
    },
    required: ['name'],
  });

  const props = schema.properties as Record<string, Record<string, unknown>>;
  assert.equal(props.name?.type, 'string');
  assert.equal(props.account_id?.description, 'keep me');
  assert.deepEqual(schema.required, ['name']);
});
