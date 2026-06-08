import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPublicAccessRedirectHref,
  hasPublicAccessParams,
  parsePublicAccessState,
  resolvePublicAccessDialog,
  stripPublicAccessParams,
} from './publicAccessState';

test('buildPublicAccessRedirectHref sends signed-out team invite users to auth with access params', () => {
  const href = buildPublicAccessRedirectHref({
    isSignedIn: false,
    state: {
      flow: 'team_invite',
      issue: 'wrong_email',
      resourceId: 'invite-123',
      inviteeEmail: 'owner@example.com',
    },
  });

  assert.equal(
    href,
    '/auth?invitation_id=invite-123&email=owner%40example.com&access_flow=team_invite&access_issue=wrong_email&access_resource_id=invite-123&access_email=owner%40example.com',
  );
});

test('buildPublicAccessRedirectHref sends signed-in platform invite users to the app surface', () => {
  const href = buildPublicAccessRedirectHref({
    isSignedIn: true,
    state: {
      flow: 'platform_invite',
      issue: 'resource_unavailable',
      resourceId: 'platform-456',
    },
  });

  assert.equal(
    href,
    '/?access_flow=platform_invite&access_issue=resource_unavailable&access_resource_id=platform-456',
  );
});

test('parsePublicAccessState supports the new route-driven contract and strips params cleanly', () => {
  const params = {
    invitation_id: 'invite-123',
    access_flow: 'team_invite',
    access_issue: 'wrong_email',
    access_resource_id: 'invite-123',
    access_email: 'owner@example.com',
  };

  assert.deepEqual(parsePublicAccessState(params), {
    flow: 'team_invite',
    issue: 'wrong_email',
    resourceId: 'invite-123',
    inviteeEmail: 'owner@example.com',
    accountName: null,
    switchAccountId: null,
  });
  assert.deepEqual(stripPublicAccessParams(params), {
    invitation_id: 'invite-123',
  });
});

test('parsePublicAccessState preserves legacy platform invite access_issue support', () => {
  assert.deepEqual(
    parsePublicAccessState({
      access_issue: 'platform_invite_unavailable',
      invitation_id: 'platform-456',
    }),
    {
      flow: 'platform_invite',
      issue: 'resource_unavailable',
      resourceId: 'platform-456',
    },
  );
});

test('hasPublicAccessParams accepts valid access redirects', () => {
  assert.equal(
    hasPublicAccessParams('?access_flow=platform_invite&access_issue=resource_completed'),
    true,
  );
});

test('hasPublicAccessParams rejects incomplete or unrelated query strings', () => {
  assert.equal(hasPublicAccessParams('?access_flow=platform_invite'), false);
  assert.equal(hasPublicAccessParams('?foo=bar'), false);
});

test('resolvePublicAccessDialog returns sign-out continuation for signed-in wrong-email states', () => {
  const dialog = resolvePublicAccessDialog({
    surface: 'signed_in',
    currentUserEmail: 'wrong@example.com',
    state: {
      flow: 'team_invite',
      issue: 'wrong_email',
      resourceId: 'invite-123',
      inviteeEmail: 'owner@example.com',
    },
  });

  assert.equal(dialog.title, 'Wrong account signed in');
  assert.equal(dialog.primaryLabel, 'Signout');
  assert.deepEqual(dialog.primaryAction, {
    kind: 'sign_out_and_navigate',
    href: '/auth?invitation_id=invite-123&email=owner%40example.com',
  });
});

