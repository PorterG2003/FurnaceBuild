import { SupabaseClient } from '@supabase/supabase-js';
import type { Mailbox } from './types.js';

export interface DatabaseConfig {
  supabase: SupabaseClient;
  batchSize?: number;
  checkIntervalMinutes?: number;
  processingTimeoutMinutes?: number;
}

/**
 * Database client for claiming mailboxes that need IMAP checking
 * Uses atomic UPDATE-based claiming to prevent duplicate processing
 */
export class DatabaseClient {
  private supabase: SupabaseClient;
  private batchSize: number;
  private checkIntervalMinutes: number;
  private processingTimeoutMinutes: number;

  constructor(config: DatabaseConfig) {
    this.supabase = config.supabase;
    this.batchSize = config.batchSize ?? 50;
    this.checkIntervalMinutes = config.checkIntervalMinutes ?? 5;
    this.processingTimeoutMinutes = config.processingTimeoutMinutes ?? 10;
  }

  /**
   * Atomically claim mailboxes that need IMAP checking
   * Returns array of mailboxes, or empty array if none found
   * 
   * This uses an atomic UPDATE operation to claim mailboxes, providing 100% guarantee
   * against duplicate processing. The function:
   * - Atomically updates mailboxes to mark as "processing" (sets last_synced_at to NOW())
   * - Only mailboxes that match criteria are updated (sync_enabled = true, status = 'connected', etc.)
   * - If worker crashes, mailbox becomes eligible again after timeout
   * 
   * This ensures that when multiple workers are running:
   * - Only one worker can successfully claim a given mailbox (atomic UPDATE)
   * - Multiple workers can claim different mailboxes in parallel
   * - No duplicate processing occurs (database-level guarantee)
   */
  async claimMailboxesToCheck(): Promise<Mailbox[]> {
    try {
      const { data, error } = await this.supabase
        .rpc('claim_mailboxes_to_check', {
          p_batch_size: this.batchSize,
          p_check_interval_minutes: this.checkIntervalMinutes,
          p_processing_timeout_minutes: this.processingTimeoutMinutes,
        });

      if (error) {
        console.error('[DATABASE] Error claiming mailboxes:', error);
        throw error;
      }

      const mailboxes = (data as Mailbox[]) || [];
      if (mailboxes.length > 0) {
        console.log(`[DATABASE] Claimed ${mailboxes.length} mailbox(es) to check`);
      }
      return mailboxes;
    } catch (error) {
      console.error('Error claiming mailboxes from database:', error);
      throw error;
    }
  }
}
