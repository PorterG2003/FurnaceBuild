import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Base URL for auth email redirects (signup confirmation, password reset).
 * Set EXPO_PUBLIC_APP_URL in .env to match Supabase Redirect URLs
 * (e.g. http://localhost:8081 or https://build.getfurnace.io).
 * Returns undefined off web so native does not invent a redirect target.
 */
export function getAppBaseUrl(): string | undefined {
  if (Platform.OS !== 'web') return undefined;
  const fromEnv = process.env.EXPO_PUBLIC_APP_URL ?? Constants.expoConfig?.extra?.appUrl;
  if (typeof fromEnv === 'string' && fromEnv) return fromEnv;
  if (typeof window !== 'undefined') return window.location.origin;
  return undefined;
}
