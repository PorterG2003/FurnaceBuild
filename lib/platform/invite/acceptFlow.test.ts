import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveInviteAcceptFlow } from './acceptFlow';

test('resolveInviteAcceptFlow returns free for a zero retainer', () => {
  assert.equal(resolveInviteAcceptFlow(0), 'free');
});

test('resolveInviteAcceptFlow returns paid for a positive retainer', () => {
  assert.equal(resolveInviteAcceptFlow(180_000), 'paid');
});
