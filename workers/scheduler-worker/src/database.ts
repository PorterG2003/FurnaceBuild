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
   * Poll database for enrollments ready to process
   * Returns array of enrollments, or empty array if none found
   */
  async poll(): Promise<Enrollment[]> {
    try {
      const { data, error } = await this.supabase
        .from('enrollments')
        .select('*')
        .eq('state', 'active')
        .lte('next_run_at', new Date().toISOString())
        .limit(this.batchSize)
        .order('next_run_at', { ascending: true }); // Process oldest first

      if (error) {
        console.error('Error polling enrollments:', error);
        throw error;
      }

      return (data as Enrollment[]) || [];
    } catch (error) {
      console.error('Error polling database:', error);
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

