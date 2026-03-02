// Capture the URL hash before createClient() processes and clears it during _initialize().
// This is the only reliable way to detect a recovery redirect on the web.
const _initialHash = typeof window !== 'undefined' ? window.location.hash : '';
export const wasRecoveryUrl = _initialHash.includes('type=recovery');

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Get Supabase URL and anon key from environment variables
// Expo uses process.env for EXPO_PUBLIC_* variables, or you can use app.json extra
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  (Constants.expoConfig?.extra?.supabaseUrl as string);

const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  (Constants.expoConfig?.extra?.supabasePublishableKey as string);

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing Supabase environment variables. Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env file or app.json'
  );
}

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
