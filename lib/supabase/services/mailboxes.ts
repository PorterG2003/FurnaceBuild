import { supabase } from '../client';
import type { Mailbox, MailboxInsert, MailboxUpdate } from '../types';

/**
 * Mailbox service for database operations
 * Handles all CRUD operations for mailboxes (SMTP/IMAP connections)
 */

/**
 * Get all mailboxes for an account
 */
export async function getMailboxesByAccount(accountId: string): Promise<Mailbox[]> {
  const { data, error } = await supabase
    .from('mailboxes')
    .select('*')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch mailboxes: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Get all mailboxes for a user (across all their accounts)
 */
export async function getMailboxesByUser(userId: string): Promise<Mailbox[]> {
  const { data, error } = await supabase
    .from('mailboxes')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch mailboxes: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Get a single mailbox by ID
 */
export async function getMailboxById(id: string): Promise<Mailbox | null> {
  const { data, error } = await supabase
    .from('mailboxes')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null;
    }
    throw new Error(`Failed to fetch mailbox: ${error.message}`);
  }

  return data;
}

/**
 * Create a new mailbox connection
 */
export async function createMailbox(mailbox: MailboxInsert): Promise<Mailbox> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('mailboxes')
    .insert({
      ...mailbox,
      created_at: mailbox.created_at ?? now,
      updated_at: mailbox.updated_at ?? now,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create mailbox: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to create mailbox: No data returned');
  }

  return data;
}

/**
 * Update a mailbox
 */
export async function updateMailbox(id: string, updates: MailboxUpdate): Promise<Mailbox> {
  const { data, error } = await supabase
    .from('mailboxes')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update mailbox: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to update mailbox: No data returned');
  }

  return data;
}

/**
 * Delete a mailbox
 */
export async function deleteMailbox(id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('mailboxes')
    .update({
      deleted_at: now,
      status: 'disconnected',
      updated_at: now,
    })
    .eq('id', id)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to delete mailbox: ${error.message}`);
  }
}

/**
 * Update mailbox status
 */
export async function updateMailboxStatus(
  id: string,
  status: 'connected' | 'disconnected' | 'error',
  errorMessage?: string | null
): Promise<Mailbox> {
  return updateMailbox(id, {
    status,
    error_message: errorMessage ?? null,
  });
}

/**
 * Update last synced timestamp
 */
export async function updateMailboxLastSynced(id: string): Promise<Mailbox> {
  return updateMailbox(id, {
    last_synced_at: new Date().toISOString(),
  });
}

/**
 * Get connected mailboxes for an account (status = 'connected'), excluding test mailboxes (*@furnace.test).
 */
export async function getConnectedMailboxes(accountId: string): Promise<Mailbox[]> {
  const { data, error } = await supabase
    .from('mailboxes')
    .select('*')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .eq('status', 'connected')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch connected mailboxes: ${error.message}`);
  }

  return (data ?? []).filter((m) => !m.email_address.endsWith('@furnace.test'));
}

