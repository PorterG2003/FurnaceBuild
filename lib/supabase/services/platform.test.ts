import assert from 'node:assert/strict';
import test from 'node:test';
import { getPlatformInvitationErrorMessage } from './platform/errors';

test('getPlatformInvitationErrorMessage maps duplicate open invite errors to a friendly message', () => {
  const message = getPlatformInvitationErrorMessage({
    code: '23505',
    message: 'duplicate key value violates unique constraint "idx_platform_invitations_open_email"',
  });

  assert.equal(
    message,
    'An open client invite already exists for this email. Open the existing client package to update or resend it.',
  );
});

test('getPlatformInvitationErrorMessage preserves unrelated Supabase errors', () => {
  const message = getPlatformInvitationErrorMessage({
    code: '42501',
    message: 'permission denied for function create_platform_invitation_draft',
  });

  assert.equal(message, 'permission denied for function create_platform_invitation_draft');
});
