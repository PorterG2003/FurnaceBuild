import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInviteSignupRedirectUrl } from './inviteSignupRedirect';

const inviteId = '3a5f2720-6a1b-40c6-96e1-f9b04534aeb1';

test('builds accept-invitation URL from base and invitation id', () => {
  assert.equal(
    buildInviteSignupRedirectUrl('https://build.getfurnace.io', inviteId),
    `https://build.getfurnace.io/accept-invitation/${inviteId}`,
  );
});

test('strips a trailing slash from the base URL', () => {
  assert.equal(
    buildInviteSignupRedirectUrl('https://build.getfurnace.io/', inviteId),
    `https://build.getfurnace.io/accept-invitation/${inviteId}`,
  );
});

test('returns undefined when base URL is missing (native / unset env)', () => {
  assert.equal(buildInviteSignupRedirectUrl(undefined, inviteId), undefined);
});

test('returns undefined when invitation id is missing', () => {
  assert.equal(buildInviteSignupRedirectUrl('https://build.getfurnace.io', undefined), undefined);
  assert.equal(buildInviteSignupRedirectUrl('https://build.getfurnace.io', ''), undefined);
});
