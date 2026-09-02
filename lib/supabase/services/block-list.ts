import { supabase } from '../client';
import type { BlockListEntry } from '../types';

export type BlockListEntryRow = BlockListEntry;

export interface BlockListQueryParams {
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: 'value' | 'type' | 'reason' | 'created_at';
  sortDirection?: 'asc' | 'desc';
}

export interface BlockListQueryResult {
  entries: BlockListEntry[];
  totalCount: number;
}

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

export async function getBlockListPage(
  accountId: string,
  params?: BlockListQueryParams,
): Promise<BlockListQueryResult> {
  const search = params?.search?.trim();
  let query = supabase
    .from('block_list')
    .select('*', { count: 'exact' })
    .eq('account_id', accountId);

  if (search) {
    query = query.ilike('value', `%${search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
  }

  const sortBy = params?.sortBy ?? 'created_at';
  const ascending = params?.sortDirection === 'asc';
  query = query.order(sortBy, { ascending, nullsFirst: !ascending });
  if (sortBy !== 'created_at') {
    query = query.order('created_at', { ascending: false });
  }

  const limit = params?.limit ?? 25;
  const offset = params?.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`Failed to fetch block list: ${error.message}`);
  }
  return {
    entries: (data ?? []) as BlockListEntry[],
    totalCount: count ?? 0,
  };
}

/**
 * Add a block list entry. Value is stored as-is (caller should normalize case if desired).
 * Enforces unique (account_id, value, type). Reason defaults to 'manual' for user-added entries.
 */
export async function addBlockEntry(
  accountId: string,
  params: { value: string; type: 'email' | 'domain'; reason?: string; source?: string }
): Promise<BlockListEntry> {
  const { value, type, reason = 'manual', source = 'inbox' } = params;
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
      source,
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

export { isEmailBlockedByEntries } from '@/lib/leads/block-list-match';

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
