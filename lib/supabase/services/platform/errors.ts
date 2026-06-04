export interface PlatformRpcErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export function getPlatformInvitationErrorMessage(error: PlatformRpcErrorLike | null | undefined): string {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  const details = typeof error?.details === 'string' ? error.details : '';
  const hint = typeof error?.hint === 'string' ? error.hint : '';
  const combined = [message, details, hint].join('\n');
  const hasOpenEmailConstraint =
    /idx_platform_invitations_open_email|platform_invitations_open_email/i.test(combined);

  if (code === '23505' && hasOpenEmailConstraint) {
    return 'An open client invite already exists for this email. Open the existing client package to update or resend it.';
  }

  return message || 'Request failed';
}
