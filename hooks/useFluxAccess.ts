import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getUserHasFluxAccess } from '@/lib/supabase/services/user-access-flags';

export type FluxAccessStatus = 'loading' | 'allowed' | 'denied';

export function useFluxAccess(): FluxAccessStatus {
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<FluxAccessStatus>('loading');
  const userId = user?.id ?? null;

  useEffect(() => {
    if (authLoading) {
      setStatus('loading');
      return;
    }
    if (!userId) {
      setStatus('denied');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    getUserHasFluxAccess(userId).then((ok) => {
      if (!cancelled) setStatus(ok ? 'allowed' : 'denied');
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId]);

  return status;
}
