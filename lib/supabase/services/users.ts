import { supabase } from '../client';
import type {
  Account,
  AccountInsert,
  AccountUpdate,
  AccountUser,
  Invitation,
  InvitationInsert,
  InvitationUpdate,
  User,
  UserInsert,
  UserUpdate,
} from '../types';

export interface AccountMembership {
  membership: AccountUser;
  account: Account;
}

/**
 * Fetch a user by their Cognito external ID.
 */
export async function getUserByExternalId(externalId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('external_id', externalId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch user: ${error.message}`);
  }

  return data ?? null;
}

/**
 * Create a new user profile.
 */
export async function createUserProfile(user: UserInsert): Promise<User> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('users')
    .insert({
      ...user,
      created_at: user.created_at ?? now,
      updated_at: user.updated_at ?? now,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create user: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to create user: No data returned');
  }

  return data;
}

/**
 * Update an existing user profile.
 */
export async function updateUserProfile(id: string, updates: UserUpdate): Promise<User> {
  const { data, error } = await supabase
    .from('users')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update user: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to update user: No data returned');
  }

  return data;
}

/**
 * Fetch account memberships for a user along with account details.
 */
export async function getAccountMembershipsForUser(userId: string): Promise<AccountMembership[]> {
  const { data: memberships, error } = await supabase
    .from('account_users')
    .select('id, account_id, user_id, is_owner, created_at, updated_at')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to fetch account memberships: ${error.message}`);
  }

  if (!memberships || memberships.length === 0) {
    return [];
  }

  const accountIds = Array.from(new Set(memberships.map((membership) => membership.account_id)));
  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('*')
    .in('id', accountIds);

  if (accountsError) {
    throw new Error(`Failed to fetch accounts: ${accountsError.message}`);
  }

  const accountsList = accounts ?? [];
  const accountMap = new Map(accountsList.map((account) => [account.id, account]));

  return memberships
    .map((membership) => {
      const account = accountMap.get(membership.account_id);
      if (!account) {
        return null;
      }
      return { membership, account };
    })
    .filter((entry): entry is AccountMembership => Boolean(entry));
}

/**
 * Create a new account.
 */
export async function createAccount(account: AccountInsert): Promise<Account> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('accounts')
    .insert({
      ...account,
      created_at: account.created_at ?? now,
      updated_at: account.updated_at ?? now,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create account: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to create account: No data returned');
  }

  return data;
}

/**
 * Add a user to an account.
 */
export async function addUserToAccount(
  accountId: string,
  userId: string,
  isOwner = false,
  role: 'owner' | 'admin' | 'member' = 'member'
): Promise<AccountUser> {
  const now = new Date().toISOString();
  // Ensure role matches is_owner
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

  if (error) {
    throw new Error(`Failed to add user to account: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to add user to account: No data returned');
  }

  return data;
}

/**
 * Update a member's role in an account.
 */
export async function updateMemberRole(
  membershipId: string,
  role: 'owner' | 'admin' | 'member'
): Promise<AccountUser> {
  // If setting to owner, ensure is_owner is true
  const isOwner = role === 'owner';
  
  const { data, error } = await supabase
    .from('account_users')
    .update({
      role,
      is_owner: isOwner,
      updated_at: new Date().toISOString(),
    })
    .eq('id', membershipId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update member role: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to update member role: No data returned');
  }

  return data;
}

/**
 * Remove a member from an account.
 */
export async function removeMemberFromAccount(membershipId: string): Promise<void> {
  const { error } = await supabase
    .from('account_users')
    .delete()
    .eq('id', membershipId);

  if (error) {
    throw new Error(`Failed to remove member from account: ${error.message}`);
  }
}

/**
 * Update an account.
 */
export async function updateAccount(id: string, updates: AccountUpdate): Promise<Account> {
  const { data, error } = await supabase
    .from('accounts')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update account: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to update account: No data returned');
  }

  return data;
}

/**
 * Get a user by email address.
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch user by email: ${error.message}`);
  }

  return data ?? null;
}

/**
 * Get all members of an account with their user details.
 */
export async function getAccountMembers(accountId: string): Promise<Array<{ user: User; membership: AccountUser }>> {
  const { data: memberships, error } = await supabase
    .from('account_users')
    .select('*')
    .eq('account_id', accountId);

  if (error) {
    throw new Error(`Failed to fetch account members: ${error.message}`);
  }

  if (!memberships || memberships.length === 0) {
    return [];
  }

  const userIds = Array.from(new Set(memberships.map((m) => m.user_id)));
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('*')
    .in('id', userIds);

  if (usersError) {
    throw new Error(`Failed to fetch users: ${usersError.message}`);
  }

  const usersList = users ?? [];
  const userMap = new Map(usersList.map((u) => [u.id, u]));

  return memberships
    .map((membership) => {
      const user = userMap.get(membership.user_id);
      if (!user) {
        return null;
      }
      return { user, membership };
    })
    .filter((entry): entry is { user: User; membership: AccountUser } => Boolean(entry));
}

/**
 * Create an invitation to join an account.
 */
export async function createInvitation(invitation: InvitationInsert): Promise<Invitation> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('invitations')
    .insert({
      ...invitation,
      email: invitation.email.toLowerCase().trim(),
      status: invitation.status ?? 'pending',
      created_at: invitation.created_at ?? now,
      updated_at: invitation.updated_at ?? now,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create invitation: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to create invitation: No data returned');
  }

  return data;
}

/**
 * Get an invitation by ID.
 */
export async function getInvitationById(id: string): Promise<Invitation | null> {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    throw new Error(`Failed to fetch invitation: ${error.message}`);
  }

  return data;
}

/**
 * Get pending invitations for an account.
 */
export async function getAccountInvitations(accountId: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch invitations: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Update an invitation.
 */
export async function updateInvitation(id: string, updates: InvitationUpdate): Promise<Invitation> {
  const { data, error } = await supabase
    .from('invitations')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update invitation: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to update invitation: No data returned');
  }

  return data;
}

/**
 * Delete an invitation.
 */
export async function deleteInvitation(id: string): Promise<void> {
  const { error } = await supabase
    .from('invitations')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete invitation: ${error.message}`);
  }
}


