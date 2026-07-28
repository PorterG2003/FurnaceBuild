/**
 * Copy for the `/no-workspace` recovery path, where a signed-in user with no
 * membership tries to redeem a pending invitation and `accept_invitation` returns
 * something other than `accepted` / `already_member`.
 */
export function invitationRecoveryFailureMessage(status: string): string {
  switch (status) {
    case 'expired':
      return 'That invitation has expired. Ask a workspace admin to send you a new one.';
    case 'not_found':
      return 'We could not find that invitation anymore. Ask a workspace admin to send you a new one.';
    case 'email_mismatch':
      return 'That invitation was sent to a different email address. Sign out and sign in with the invited address.';
    case 'revoked':
      return 'That invitation was revoked. Ask a workspace admin to send you a new one.';
    default:
      return 'That invitation is no longer available. Ask a workspace admin to send you a new one.';
  }
}

/** `accept_invitation` statuses that mean the membership now exists. */
export function isInvitationJoinSuccess(status: string): boolean {
  return status === 'accepted' || status === 'already_member';
}
