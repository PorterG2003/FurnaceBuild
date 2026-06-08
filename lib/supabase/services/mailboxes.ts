import { supabase } from '../client';
import type { Mailbox, MailboxInsert, MailboxUpdate } from '../types';
import {
  getMailboxOverviewUtcKeys,
  mergeMailboxOverviewData,
  type MailboxCampaignAssignmentRow,
  type MailboxOverview,
  type MailboxThrottleOverviewRow,
} from './mailboxes-core';

const ACTIVE_CAMPAIGN_STATUSES = ['running', 'paused'] as const;
export { getMailboxOverviewUtcKeys, mergeMailboxOverviewData } from './mailboxes-core';
export type { MailboxOverview } from './mailboxes-core';

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
 * Get mailbox rows enriched with current-day throttle data and active campaign counts.
 */
export async function getMailboxOverviewsByAccount(accountId: string): Promise<MailboxOverview[]> {
  const { date } = getMailboxOverviewUtcKeys();

  const [mailboxes, throttlesResult, activeCampaignsResult] = await Promise.all([
    getMailboxesByAccount(accountId),
    (supabase as any)
      .from('mailbox_throttles')
      .select('mailbox_id, sent_count, hourly_sent, last_sent_at')
      .eq('account_id', accountId)
      .eq('date', date),
    supabase
      .from('campaigns')
      .select('id')
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .in('status', [...ACTIVE_CAMPAIGN_STATUSES]),
  ]);

  if (throttlesResult.error) {
    throw new Error(`Failed to fetch mailbox throttles: ${throttlesResult.error.message}`);
  }

  if (activeCampaignsResult.error) {
    throw new Error(`Failed to fetch active campaigns: ${activeCampaignsResult.error.message}`);
  }

  const activeCampaignIds = (activeCampaignsResult.data ?? []).map((campaign) => campaign.id);
  let assignments: MailboxCampaignAssignmentRow[] = [];

  if (activeCampaignIds.length > 0) {
    const { data, error } = await supabase
      .from('campaign_mailboxes')
      .select('mailbox_id')
      .eq('account_id', accountId)
      .in('campaign_id', activeCampaignIds);

    if (error) {
      throw new Error(`Failed to fetch active campaign mailbox assignments: ${error.message}`);
    }

    assignments = (data ?? []) as MailboxCampaignAssignmentRow[];
  }

  return mergeMailboxOverviewData(
    mailboxes,
    ((throttlesResult.data ?? []) as MailboxThrottleOverviewRow[]),
    assignments
  );
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
  return updateMailboxConnectionHealth(id, {
    status,
    error_message: errorMessage ?? null,
  });
}

/**
 * Update mailbox IMAP/SMTP health fields without touching credentials or profile data.
 */
export async function updateMailboxConnectionHealth(
  id: string,
  patch: Pick<MailboxUpdate, 'status' | 'smtp_status' | 'error_message'>
): Promise<Mailbox> {
  return updateMailbox(id, patch);
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

