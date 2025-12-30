import { SupabaseClient, createClient } from '@supabase/supabase-js';

/**
 * Create Supabase client for scheduler worker
 * 
 * Environment variables required:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_KEY: Service role key (admin privileges)
 */
export function createSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Missing required environment variables: SUPABASE_URL or SUPABASE_SERVICE_KEY'
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

