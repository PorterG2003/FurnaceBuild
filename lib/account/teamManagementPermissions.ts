import type { AccountUser } from '@/lib/supabase/types';

type TeamManagementMembership = Pick<AccountUser, 'role' | 'is_owner'> | null | undefined;

export function getAccountMembershipRole(
  membership: TeamManagementMembership
): 'owner' | 'admin' | 'member' {
  const role = membership?.role;
  if (role === 'owner' || role === 'admin' || role === 'member') {
    return role;
  }

  return membership?.is_owner ? 'owner' : 'member';
}

export function canManageAccountTeam(membership: TeamManagementMembership): boolean {
  const role = getAccountMembershipRole(membership);
  return role === 'owner' || role === 'admin';
}
