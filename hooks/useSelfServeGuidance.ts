import { useEffect, useState } from 'react';
import type { SelfServeGuidanceInfo } from '@/lib/supabase/services/platform';
import { getSelfServeGuidanceInfo } from '@/lib/supabase/services/platform';

export function useSelfServeGuidance(email?: string | null) {
  const [data, setData] = useState<SelfServeGuidanceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSelfServeGuidanceInfo(email ?? null)
      .then((info) => {
        if (!cancelled) setData(info);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load guidance.');
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [email]);

  return { data, loading, error };
}
