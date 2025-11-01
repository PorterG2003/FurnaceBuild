import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { supabase } from '@/lib/supabase/client';
import { useEffect } from 'react';

/**
 * Hook to get Supabase client with current user context
 * Provides helper functions that automatically filter by current user
 */
export function useSupabase() {
  const { user, authStatus } = useAuthenticator();
  const userId = user?.userId;

  useEffect(() => {
    // If you implement token-based auth later, update here
    // For now, we'll handle filtering at the service level
  }, [userId, authStatus]);

  return {
    supabase,
    userId,
    isAuthenticated: authStatus === 'authenticated',
  };
}


