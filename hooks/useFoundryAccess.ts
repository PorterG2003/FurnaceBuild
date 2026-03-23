import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getUserHasFoundryAccess } from '@/lib/supabase/services/user-access-flags';

export type FoundryAccessStatus = 'loading' | 'allowed' | 'denied';

/**
 * Resolves whether the current user may access /foundry/* (server-backed row).
 */
export function useFoundryAccess(): FoundryAccessStatus {
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<FoundryAccessStatus>('loading');

  useEffect(() => {
    if (authLoading) {
      setStatus('loading');
      return;
    }
    if (!user) {
      setStatus('denied');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    getUserHasFoundryAccess(user.id).then((ok) => {
      if (!cancelled) setStatus(ok ? 'allowed' : 'denied');
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  return status;
}
