import { SupabaseClient } from '@supabase/supabase-js';
import type { Mailbox } from './types.js';

/**
 * Select a mailbox for sending using round-robin load balancing
 * 
 * Loads available mailboxes for the campaign's account and selects one
 * using round-robin distribution based on rotationIndex.
 * 
 * @param accountId - Account ID to load mailboxes for
 * @param supabase - Supabase client
 * @param rotationIndex - Current rotation index for round-robin (incremented per enrollment)
 * @returns Selected mailbox or null if none available
 */
export async function selectMailbox(
  accountId: string,
  supabase: SupabaseClient,
  rotationIndex: number = 0
): Promise<Mailbox | null> {
  // Load available mailboxes for account
  const { data: mailboxes, error } = await supabase
    .from('mailboxes')
    .select('*')
    .eq('account_id', accountId)
    .eq('smtp_status', 'active')
    .eq('status', 'connected')
    .order('created_at', { ascending: true }); // Consistent ordering for round-robin
  
  if (error) {
    console.error('Error loading mailboxes:', error);
    return null;
  }
  
  if (!mailboxes || mailboxes.length === 0) {
    console.warn(`No available mailboxes for account ${accountId}`);
    return null;
  }
  
  // Round-robin selection: rotate through available mailboxes
  const selectedIndex = rotationIndex % mailboxes.length;
  return mailboxes[selectedIndex] as Mailbox;
}

