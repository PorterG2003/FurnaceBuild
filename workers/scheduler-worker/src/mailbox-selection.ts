import { SupabaseClient } from '@supabase/supabase-js';
import type { Mailbox } from './types.js';
import { logger } from './logger.js';

export interface CampaignMailboxRow {
  mailbox_id: string;
  mailbox: Mailbox | null;
}

export function getEligibleMailboxes(campaignMailboxes: CampaignMailboxRow[]): Mailbox[] {
  return campaignMailboxes
    .map((item) => item.mailbox)
    .filter(
      (mailbox): mailbox is Mailbox =>
        mailbox !== null &&
        !mailbox.deleted_at &&
        mailbox.status === 'connected' &&
        mailbox.smtp_status === 'active',
    );
}

export function selectMailboxFromPool(
  campaignId: string,
  availableMailboxes: Mailbox[],
  rotationIndex: number = 0,
): Mailbox | null {
  if (availableMailboxes.length === 0) {
    logger.warn(`No available (active/connected) mailboxes for campaign ${campaignId}`);
    return null;
  }

  const selectedIndex = rotationIndex % availableMailboxes.length;
  const selectedMailbox = availableMailboxes[selectedIndex] as Mailbox;

  logger.debug(
    `[MAILBOX DIST] Campaign ${campaignId.substring(0, 8)}: Selected mailbox ${selectedMailbox.id.substring(0, 8)} (index ${selectedIndex}/${availableMailboxes.length}, rotationIndex: ${rotationIndex})`,
  );

  return selectedMailbox;
}

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
    logger.error('Error loading campaign mailboxes:', error);
    return null;
  }
  
  if (!mailboxes || mailboxes.length === 0) {
    logger.warn(`No mailboxes assigned to campaign ${campaignId}`);
    return null;
  }

  return selectMailboxFromPool(
    campaignId,
    getEligibleMailboxes(mailboxes as unknown as CampaignMailboxRow[]),
    rotationIndex,
  );
}

