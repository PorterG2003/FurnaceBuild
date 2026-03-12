import { supabase } from '../../client';
import type { Account, AccountUser, User } from '../../types';

export interface AccountMembership {
  membership: AccountUser;
  account: Account;
}

export async function getAccountMembershipsForUser(userId: string): Promise<AccountMembership[]> {
  const { data: memberships, error } = await supabase
    .from('account_users')
    .select('id, account_id, user_id, is_owner, role, created_at, updated_at')
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to fetch account memberships: ${error.message}`);
  if (!memberships?.length) return [];

  const accountIds = Array.from(new Set(memberships.map((m) => m.account_id)));
  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('*')
    .in('id', accountIds);

  if (accountsError) throw new Error(`Failed to fetch accounts: ${accountsError.message}`);
  const accountMap = new Map((accounts ?? []).map((a) => [a.id, a]));

  return memberships
    .map((membership) => {
      const account = accountMap.get(membership.account_id);
      return account ? { membership, account } : null;
    })
    .filter((entry): entry is AccountMembership => Boolean(entry));
}

export async function addUserToAccount(
  accountId: string,
  userId: string,
  isOwner = false,
  role: 'owner' | 'admin' | 'member' = 'member'
): Promise<AccountUser> {
  const now = new Date().toISOString();
  const finalRole = isOwner ? 'owner' : role;
  const { data, error } = await supabase
    .from('account_users')
    .insert({
      account_id: accountId,
      user_id: userId,
      is_owner: isOwner,
      role: finalRole,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to add user to account: ${error.message}`);
  if (!data) throw new Error('Failed to add user to account: No data returned');
  return data;
}

export async function updateMemberRole(
  membershipId: string,
  role: 'owner' | 'admin' | 'member'
): Promise<AccountUser> {
  const isOwner = role === 'owner';
  const { data, error } = await supabase
    .from('account_users')
    .update({ role, is_owner: isOwner, updated_at: new Date().toISOString() })
    .eq('id', membershipId)
    .select()
    .single();
  if (error) throw new Error(`Failed to update member role: ${error.message}`);
  if (!data) throw new Error('Failed to update member role: No data returned');
  return data;
}

export async function removeMemberFromAccount(membershipId: string): Promise<void> {
  const { error } = await supabase.from('account_users').delete().eq('id', membershipId);
  if (error) throw new Error(`Failed to remove member from account: ${error.message}`);
}

export async function getAccountMembers(accountId: string): Promise<Array<{ user: User; membership: AccountUser }>> {
  const { data: memberships, error } = await supabase
    .from('account_users')
    .select('*')
    .eq('account_id', accountId);
  if (error) throw new Error(`Failed to fetch account members: ${error.message}`);
  if (!memberships?.length) return [];

  const userIds = Array.from(new Set(memberships.map((m) => m.user_id)));
  const { data: users, error: usersError } = await supabase.from('users').select('*').in('id', userIds);
  if (usersError) throw new Error(`Failed to fetch users: ${usersError.message}`);
  const userMap = new Map((users ?? []).map((u) => [u.id, u]));

  return memberships
    .map((membership) => {
      const user = userMap.get(membership.user_id);
      return user ? { user, membership } : null;
    })
    .filter((entry): entry is { user: User; membership: AccountUser } => Boolean(entry));
}
