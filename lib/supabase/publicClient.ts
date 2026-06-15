import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabasePublishableKey, supabaseUrl } from './config';

let cachedPublicSupabase: SupabaseClient | null = null;

/**
 * Public-only Supabase client for routes that must behave the same regardless of login state.
 * This client never persists or reuses the browser's authenticated session.
 */
export function getPublicSupabaseClient(): SupabaseClient {
  if (!cachedPublicSupabase) {
    cachedPublicSupabase = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
  }
  return cachedPublicSupabase;
}

export const publicSupabase = getPublicSupabaseClient();
