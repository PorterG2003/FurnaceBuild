import { supabase } from '../../client';
import type { Invitation, InvitationInsert, InvitationUpdate } from '../../types';

export interface InvitationInfo {
  status: string;
  account_name?: string;
  inviter_name?: string;
  invitee_email?: string;
  expires_at?: string;
}

export interface AcceptInvitationResult {
  status: string;
  account_id?: string;
}

export interface PendingInvitationForCurrentUser {
  invitation_id: string;
  account_id: string;
  account_name: string;
  inviter_name: string | null;
  created_at: string;
}

export interface InviteUserToAccountResult {
  status: string;
  invitation_id?: string;
}

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
  if (error) throw new Error(`Failed to create invitation: ${error.message}`);
  if (!data) throw new Error('Failed to create invitation: No data returned');
  return data;
}

export async function getInvitationById(id: string): Promise<Invitation | null> {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch invitation: ${error.message}`);
  }
  return data;
}

export async function getAccountInvitations(accountId: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to fetch invitations: ${error.message}`);
  return data ?? [];
}

export async function updateInvitation(id: string, updates: InvitationUpdate): Promise<Invitation> {
  const { data, error } = await supabase
    .from('invitations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Failed to update invitation: ${error.message}`);
  if (!data) throw new Error('Failed to update invitation: No data returned');
  return data;
}

export async function deleteInvitation(id: string): Promise<void> {
  const { error } = await supabase.from('invitations').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete invitation: ${error.message}`);
}

export async function getInvitationInfo(invitationId: string): Promise<InvitationInfo> {
  const { data, error } = await supabase.rpc('get_invitation_info', {
    p_invitation_id: invitationId,
  });
  if (error) throw new Error(error.message);
  return data as InvitationInfo;
}

/**
 * Pending invitations for the signed-in user's own email, excluding accounts they
 * already belong to. Uses an RPC because `accounts` is hidden by RLS until the
 * membership exists, which is exactly the state this is meant to recover from.
 */
export async function getMyPendingInvitations(): Promise<PendingInvitationForCurrentUser[]> {
  const { data, error } = await supabase.rpc('get_my_pending_invitations');
  if (error) throw new Error(error.message);
  return (data ?? []) as PendingInvitationForCurrentUser[];
}

export async function acceptInvitationRpc(invitationId: string): Promise<AcceptInvitationResult> {
  const { data, error } = await supabase.rpc('accept_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) throw new Error(error.message);
  return data as AcceptInvitationResult;
}

export async function inviteUserToAccount(
  accountId: string,
  email: string,
  invitedByUserId: string
): Promise<InviteUserToAccountResult> {
  const { data, error } = await supabase.rpc('invite_user_to_account', {
    p_account_id: accountId,
    p_email: email.trim().toLowerCase(),
    p_invited_by: invitedByUserId,
  });
  if (error) throw new Error(error.message);
  return data as InviteUserToAccountResult;
}
