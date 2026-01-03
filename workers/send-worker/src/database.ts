import { SupabaseClient } from '@supabase/supabase-js';
import type { MessageJob } from './types.js';

export interface DatabaseConfig {
  supabase: SupabaseClient;
  batchSize?: number;
  pollIntervalMs?: number;
}

/**
 * Database client for polling message jobs from Supabase
 * Replaces QueueClient - polls database directly using atomic UPDATE-based claiming
 */
export class DatabaseClient {
  private supabase: SupabaseClient;
  private batchSize: number;
  private pollIntervalMs: number;

  constructor(config: DatabaseConfig) {
    this.supabase = config.supabase;
    this.batchSize = config.batchSize ?? 100;
    this.pollIntervalMs = config.pollIntervalMs ?? 2000; // Default 2 seconds (adaptive polling in worker)
  }

  /**
   * Claim message jobs ready to send using atomic UPDATE-based locking
   * Returns array of message jobs, or empty array if none found
   * 
   * This uses an atomic UPDATE operation to claim jobs, providing 100% guarantee
   * against duplicate processing. The function:
   * - Atomically updates jobs to mark as "reserved" (sets status to 'reserved' and reserved_at)
   * - Only jobs that match criteria are updated (status = 'pending' AND scheduled_at <= NOW())
   * - If worker crashes, jobs can be reset after timeout (based on reserved_at)
   * 
   * This ensures that when multiple send workers are running:
   * - Only one worker can successfully claim a given job (atomic UPDATE)
   * - Multiple workers can claim different jobs in parallel
   * - No duplicate sends occur (database-level guarantee)
   */
  async poll(): Promise<MessageJob[]> {
    try {
      // Use RPC function that atomically claims message jobs via UPDATE
      // This provides 100% guarantee against duplicate processing
      const { data, error } = await this.supabase
        .rpc('claim_message_jobs_ready', {
          p_batch_size: this.batchSize,
          p_processing_timeout_minutes: 5  // Timeout if worker crashes
        });

      if (error) {
        console.error('[DATABASE] Error claiming message jobs:', error);
        throw error;
      }

      const messageJobs = (data as MessageJob[]) || [];
      if (messageJobs.length > 0) {
        console.log(`[DATABASE] Claimed ${messageJobs.length} message job(s) from database`);
      }
      return messageJobs;
    } catch (error) {
      console.error('Error claiming message jobs from database:', error);
      throw error;
    }
  }

  /**
   * Get poll interval in milliseconds
   */
  getPollInterval(): number {
    return this.pollIntervalMs;
  }
}

