import { supabase } from '../../client';
import type { Account, AccountUser, User } from '../../types';

export interface AccountMembership {
  membership: AccountUser;
  account: Account;
}

export async function getAccountMembershipsForUser(userId: string): Promise<AccountMembership[]> {
  const { data: rows, error } = await supabase
    .from('account_users')
    .select('*, account:accounts(*)')
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to fetch account memberships: ${error.message}`);
  if (!rows?.length) return [];

  return rows
    .map((row) => {
      const account = row.account as Account | null;
      if (!account) return null;
      const { account: _account, ...membership } = row;
      return { membership: membership as AccountUser, account };
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
  const { data: rows, error } = await supabase
    .from('account_users')
    .select('*, user:users(*)')
    .eq('account_id', accountId);
  if (error) throw new Error(`Failed to fetch account members: ${error.message}`);
  if (!rows?.length) return [];

  return rows
    .map((row) => {
      const user = row.user as User | null;
      if (!user) return null;
      const { user: _user, ...membership } = row;
      return { user, membership: membership as AccountUser };
    })
    .filter((entry): entry is { user: User; membership: AccountUser } => Boolean(entry));
}
