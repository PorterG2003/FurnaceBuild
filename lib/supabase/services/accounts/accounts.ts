import { supabase } from '../../client';
import type { Account, AccountInsert, AccountUpdate } from '../../types';

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
  if (error) throw new Error(`Failed to create account: ${error.message}`);
  if (!data) throw new Error('Failed to create account: No data returned');
  return data;
}

export async function updateAccount(id: string, updates: AccountUpdate): Promise<Account> {
  const { data, error } = await supabase
    .from('accounts')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Failed to update account: ${error.message}`);
  if (!data) throw new Error('Failed to update account: No data returned');
  return data;
}
