/**
 * Confirmation-email redirect for team-invite signup.
 * Lands on /accept-invitation/{id} so the membership is created even when the
 * original signup tab is gone (cross-device / closed tab).
 */
export function buildInviteSignupRedirectUrl(
  baseUrl: string | undefined,
  invitationId: string | undefined,
): string | undefined {
  if (!baseUrl || !invitationId) return undefined;
  return `${baseUrl.replace(/\/$/, '')}/accept-invitation/${invitationId}`;
}
