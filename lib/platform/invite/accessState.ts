export function isPlatformInviteUnavailableStatus(status: string | null | undefined): boolean {
  return status === 'expired' || status === 'revoked' || status === 'not_found';
}

export function isPlatformInviteCompletedStatus(status: string | null | undefined): boolean {
  return status === 'active';
}
