import { SupabaseClient, createClient } from '@supabase/supabase-js';

/**
 * Create Supabase client for scheduler worker
 * 
 * Environment variables required:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SECRET_KEY: Supabase Secret Key (bypasses RLS)
 */
export function createSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(
      'Missing required environment variables: SUPABASE_URL or SUPABASE_SECRET_KEY'
    );
  }

  return createClient(supabaseUrl, supabaseSecretKey);
}

