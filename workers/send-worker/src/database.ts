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
   * Claim manual (inbox reply/forward) jobs first — manual sends take priority.
   */
  async pollManual(): Promise<MessageJob[]> {
    try {
      const { data, error } = await this.supabase
        .rpc('claim_manual_message_jobs_ready', {
          p_batch_size: Math.min(this.batchSize, 50),
          p_processing_timeout_minutes: 5,
        });

      if (error) {
        console.error('[DATABASE] Error claiming manual message jobs:', error);
        throw error;
      }

      const jobs = (data as MessageJob[]) || [];
      if (jobs.length > 0) {
        console.log(`[DATABASE] Claimed ${jobs.length} manual message job(s)`);
      }
      return jobs;
    } catch (error) {
      console.error('Error claiming manual message jobs:', error);
      throw error;
    }
  }

  /**
   * Claim campaign message jobs ready to send using atomic UPDATE-based locking
   * Returns array of message jobs, or empty array if none found
   */
  async poll(): Promise<MessageJob[]> {
    try {
      const { data, error } = await this.supabase
        .rpc('claim_message_jobs_ready', {
          p_batch_size: this.batchSize,
          p_processing_timeout_minutes: 5,
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

