/**
 * Shared auth token helper for non-Supabase backend calls.
 * Use this when you need a Bearer token for Function URLs or other APIs;
 * do not duplicate supabase.auth.getSession() in lib/services.
 */
export { getAccessToken } from '@/lib/supabase/client';
