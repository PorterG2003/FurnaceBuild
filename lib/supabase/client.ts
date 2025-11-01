import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Get Supabase URL and anon key from environment variables
// Expo uses process.env for EXPO_PUBLIC_* variables, or you can use app.json extra
const supabaseUrl = 
  process.env.EXPO_PUBLIC_SUPABASE_URL || 
  (Constants.expoConfig?.extra?.supabaseUrl as string);
  
const supabaseAnonKey = 
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 
  (Constants.expoConfig?.extra?.supabaseAnonKey as string);

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env file or app.json'
  );
}

// Create Supabase client
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // We're not using Supabase auth, so disable auto-refresh
    autoRefreshToken: false,
    persistSession: false,
  },
  // Enable realtime if needed (optional)
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

/**
 * Updates Supabase client with Amplify auth token
 * This allows Supabase to identify the authenticated user for RLS policies
 * 
 * @param amplifyUserId - The user ID from Amplify Cognito
 */
export async function setSupabaseAuth(amplifyUserId: string): Promise<void> {
  // Set a custom header or use service role for admin operations
  // For user-scoped queries, we'll filter by owner_id in app code
  // If you want RLS support, you'd need to exchange Amplify token for Supabase JWT
  // For now, we'll handle authorization at the application level
}

/**
 * Clears Supabase auth (on logout)
 */
export async function clearSupabaseAuth(): Promise<void> {
  await supabase.auth.signOut();
}

