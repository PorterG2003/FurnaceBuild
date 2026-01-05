import { SupabaseClient } from '@supabase/supabase-js';
import type { Mailbox } from './types.js';

/**
 * Select a mailbox for sending using round-robin load balancing
 * 
 * Loads mailboxes assigned to the campaign (via campaign_mailboxes junction table)
 * and selects one using round-robin distribution based on rotationIndex.
 * 
 * @param campaignId - Campaign ID to load assigned mailboxes for
 * @param supabase - Supabase client
 * @param rotationIndex - Current rotation index for round-robin (incremented per enrollment)
 * @returns Selected mailbox or null if none available
 */
export async function selectMailbox(
  campaignId: string,
  supabase: SupabaseClient,
  rotationIndex: number = 0
): Promise<Mailbox | null> {
  // Load mailboxes assigned to this campaign via junction table
  const { data: mailboxes, error } = await supabase
    .from('campaign_mailboxes')
    .select(`
      mailbox:mailboxes(*)
    `)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true }); // Consistent ordering for round-robin
  
  if (error) {
    console.error('Error loading campaign mailboxes:', error);
    return null;
  }
  
  if (!mailboxes || mailboxes.length === 0) {
    console.warn(`No mailboxes assigned to campaign ${campaignId}`);
    return null;
  }
  
  // Extract mailbox objects from the join result
  // Filter to only active/connected mailboxes
  const availableMailboxes = mailboxes
    .map((item: any) => item.mailbox)
    .filter((mailbox: Mailbox) => 
      mailbox.status === 'connected' && 
      mailbox.smtp_status === 'active'
    );
  
  if (availableMailboxes.length === 0) {
    console.warn(`No available (active/connected) mailboxes for campaign ${campaignId}`);
    return null;
  }
  
  // Round-robin selection: rotate through available mailboxes
  const selectedIndex = rotationIndex % availableMailboxes.length;
  return availableMailboxes[selectedIndex] as Mailbox;
}

