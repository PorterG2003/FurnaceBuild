import { supabase } from '../client';
import type { BlockListEntry } from '../types';

export type BlockListEntryRow = BlockListEntry;

/**
 * Get all block list entries for an account.
 */
export async function getBlockList(accountId: string): Promise<BlockListEntry[]> {
  const { data, error } = await supabase
    .from('block_list')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch block list: ${error.message}`);
  }
  return (data ?? []) as BlockListEntry[];
}

/**
 * Add a block list entry. Value is stored as-is (caller should normalize case if desired).
 * Enforces unique (account_id, value, type). Reason defaults to 'manual' for user-added entries.
 */
export async function addBlockEntry(
  accountId: string,
  params: { value: string; type: 'email' | 'domain'; reason?: string }
): Promise<BlockListEntry> {
  const { value, type, reason = 'manual' } = params;
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) {
    throw new Error('Block list value cannot be empty');
  }

  const { data, error } = await supabase
    .from('block_list')
    .insert({
      account_id: accountId,
      value: normalizedValue,
      type,
      reason,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(`Already blocked: ${normalizedValue}`);
    }
    throw new Error(`Failed to add block entry: ${error.message}`);
  }
  return data as BlockListEntry;
}

/**
 * Remove a block list entry by id.
 */
export async function removeBlockEntry(
  accountId: string,
  entryId: string
): Promise<void> {
  const { error } = await supabase
    .from('block_list')
    .delete()
    .eq('id', entryId)
    .eq('account_id', accountId);

  if (error) {
    throw new Error(`Failed to remove block entry: ${error.message}`);
  }
}

/**
 * Extract domain from email (part after @). Returns null if malformed.
 */
function getDomainFromEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1 || atIndex === trimmed.length - 1) return null;
  return trimmed.slice(atIndex + 1);
}

/**
 * Check if an email is blocked by any entry in the account's block list.
 * Matches exact email (type='email') or domain (type='domain').
 */
export function isEmailBlockedByEntries(
  email: string,
  entries: BlockListEntry[]
): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  const domain = getDomainFromEmail(email);

  for (const entry of entries) {
    const entryValue = entry.value.trim().toLowerCase();
    if (entry.type === 'email') {
      if (entryValue === normalizedEmail) return true;
    } else if (entry.type === 'domain' && domain) {
      if (entryValue === domain) return true;
    }
  }
  return false;
}

/**
 * Check if an email is blocked for an account. Fetches block list and checks.
 * Use this when you need a one-off check. For multiple checks, fetch once
 * and use isEmailBlockedByEntries.
 */
export async function isEmailBlocked(
  accountId: string,
  email: string
): Promise<boolean> {
  const entries = await getBlockList(accountId);
  return isEmailBlockedByEntries(email, entries);
}
