import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPlatformInviteCompletedStatus,
  isPlatformInviteUnavailableStatus,
} from './accessState';

test('isPlatformInviteUnavailableStatus matches unavailable platform invite states', () => {
  assert.equal(isPlatformInviteUnavailableStatus('expired'), true);
  assert.equal(isPlatformInviteUnavailableStatus('revoked'), true);
  assert.equal(isPlatformInviteUnavailableStatus('not_found'), true);
  assert.equal(isPlatformInviteUnavailableStatus('active'), false);
  assert.equal(isPlatformInviteUnavailableStatus('pending_payment'), false);
});

test('isPlatformInviteCompletedStatus treats active invites as already accepted', () => {
  assert.equal(isPlatformInviteCompletedStatus('active'), true);
  assert.equal(isPlatformInviteCompletedStatus('expired'), false);
  assert.equal(isPlatformInviteCompletedStatus('pending_payment'), false);
  assert.equal(isPlatformInviteCompletedStatus(null), false);
});
