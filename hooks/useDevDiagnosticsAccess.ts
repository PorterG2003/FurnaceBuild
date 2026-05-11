import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getUserHasDevDiagnosticsAccess } from '@/lib/supabase/services/user-access-flags';

export type DevDiagnosticsAccessStatus = 'loading' | 'allowed' | 'denied';

/**
 * Whether the current user may see full campaign schedule / message_job diagnostics
 * (`user_access_flags.flag_key = dev_diagnostics`, service-managed).
 */
export function useDevDiagnosticsAccess(): DevDiagnosticsAccessStatus {
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<DevDiagnosticsAccessStatus>('loading');
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
    getUserHasDevDiagnosticsAccess(userId).then((ok) => {
      if (!cancelled) setStatus(ok ? 'allowed' : 'denied');
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId]);

  return status;
}
