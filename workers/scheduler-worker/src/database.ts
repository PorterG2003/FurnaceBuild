import {
  formatUnknownError,
  isRetryableSupabaseReadError,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import { SupabaseClient } from '@supabase/supabase-js';
import type { Enrollment } from './types.js';

export interface DatabaseConfig {
  supabase: SupabaseClient;
  batchSize?: number;
  pollIntervalMs?: number;
}

/**
 * Database client for polling enrollments from Supabase
 * Similar to QueueClient in send-worker, but polls database instead of SQS
 */
export class DatabaseClient {
  private supabase: SupabaseClient;
  private batchSize: number;
  private pollIntervalMs: number;

  constructor(config: DatabaseConfig) {
    this.supabase = config.supabase;
    this.batchSize = config.batchSize ?? 100;
    this.pollIntervalMs = config.pollIntervalMs ?? 5000; // Poll every 5 seconds
  }

  /**
   * Claim enrollments ready to process using atomic UPDATE-based locking
   * Returns array of enrollments, or empty array if none found
   * 
   * This uses an atomic UPDATE operation to claim enrollments, providing 100% guarantee
   * against duplicate processing. The function:
   * - Atomically updates enrollments to mark as "processing" (sets next_run_at to future time)
   * - Only enrollments that match criteria are updated (WHERE clause ensures this)
   * - If worker crashes, enrollment becomes eligible again after timeout
   * 
   * This ensures that when multiple scheduler workers are running:
   * - Only one worker can successfully claim a given enrollment (atomic UPDATE)
   * - Multiple workers can claim different enrollments in parallel
   * - No duplicate message jobs are created (database-level guarantee)
   */
  async poll(): Promise<Enrollment[]> {
    try {
      // Use RPC function that atomically claims enrollments via UPDATE
      // This provides 100% guarantee against duplicate processing
      const { data, error } = await this.supabase
        .rpc('claim_enrollments_ready', {
          p_batch_size: this.batchSize,
          p_processing_timeout_minutes: 5  // Timeout if worker crashes
        });

      if (error) {
        console.error('[DATABASE] Error claiming enrollments:', error);
        throw error;
      }

      const enrollments = (data as Enrollment[]) || [];
      if (enrollments.length > 0) {
        console.log(`[DATABASE] Claimed ${enrollments.length} enrollment(s) from database`);
      }
      return enrollments;
    } catch (error) {
      console.error('Error claiming enrollments from database:', error);
      const msg = formatUnknownError(error);
      reportErrorToSlack('Scheduler: error claiming enrollments from database', {
        severity: isRetryableSupabaseReadError(msg) ? 'warning' : 'critical',
        error: msg,
        alertPolicy: isRetryableSupabaseReadError(msg)
          ? 'transient_retryable_warning'
          : 'critical_failure',
        aggregationKey: isRetryableSupabaseReadError(msg)
          ? 'scheduler-claim-enrollments'
          : undefined,
        summaryFields: {
          worker: 'scheduler',
          operation: 'claim_enrollments_ready',
        },
      });
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

