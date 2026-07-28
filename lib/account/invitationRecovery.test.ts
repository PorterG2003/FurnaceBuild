import assert from 'node:assert/strict';
import test from 'node:test';
import {
  invitationRecoveryFailureMessage,
  isInvitationJoinSuccess,
} from './invitationRecovery';

test('treats accepted and already_member as success', () => {
  assert.equal(isInvitationJoinSuccess('accepted'), true);
  assert.equal(isInvitationJoinSuccess('already_member'), true);
});

test('treats every other accept_invitation status as failure', () => {
  for (const status of ['expired', 'not_found', 'email_mismatch', 'revoked', 'pending', '']) {
    assert.equal(isInvitationJoinSuccess(status), false, status);
  }
});

test('tells the user to use the invited address on an email mismatch', () => {
  assert.match(invitationRecoveryFailureMessage('email_mismatch'), /invited address/);
});

test('directs the user to request a new invite for expired, missing, and revoked invites', () => {
  for (const status of ['expired', 'not_found', 'revoked']) {
    assert.match(invitationRecoveryFailureMessage(status), /send you a new one/, status);
  }
});

test('falls back to a generic message for unrecognized statuses', () => {
  const message = invitationRecoveryFailureMessage('something_unexpected');
  assert.match(message, /no longer available/);
  // Raw status strings are internal; they must not leak into customer-facing copy.
  assert.doesNotMatch(message, /something_unexpected/);
});
