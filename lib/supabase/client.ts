// Capture the URL hash before createClient() processes and clears it during _initialize().
// This is the only reliable way to detect a recovery redirect on the web.
const _initialHash = typeof window !== 'undefined' ? window.location.hash : '';
export const wasRecoveryUrl = _initialHash.includes('type=recovery');

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';
import { supabasePublishableKey, supabaseUrl } from './config';

// Create Supabase client with Supabase Auth (session persisted via AsyncStorage)
export const supabase: SupabaseClient = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

/**
 * Get the current Supabase session (for RLS / auth.uid()).
 */
export async function getSession(): Promise<Session | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Get the current Supabase user (for RLS / auth.uid()).
 */
export async function getCurrentUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Get the current Supabase access token (e.g. for Bearer auth to backend/Function URLs).
 * Prefer this over raw getSession() when you only need the token.
 */
export async function getAccessToken(): Promise<string | null> {
  // Validate/refresh the session with Supabase Auth before returning a Bearer token
  // for Function URLs. getSession() alone can return a stale access_token from storage.
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return null;
  }
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * Sign out the current user. Use this instead of raw supabase.auth.signOut() in app code.
 */
export function signOut(): Promise<{ error: Error | null }> {
  return supabase.auth.signOut();
}
