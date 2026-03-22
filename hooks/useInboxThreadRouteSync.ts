import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Router } from 'expo-router';
import type { EmailThread } from '@/lib/supabase/types';

/** `useLocalSearchParams` may return `string | string[]` for a query key. */
export function normalizeInboxThreadParam(
  thread: string | string[] | undefined
): string | undefined {
  if (thread == null) return undefined;
  const v = Array.isArray(thread) ? thread[0] : thread;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Keeps `?thread=` and `selectedThreadId` aligned in one pass (avoids two effects
 * seeing stale selection and clearing the URL before URL→state runs).
 *
 * Order: invalidate bad params → setParams when selection and URL disagree →
 * hydrate selection from URL when still on list with no selection (deep links).
 */
export function useInboxThreadRouteSync({
  threadParamRaw,
  threads,
  threadsLoading,
  selectedThreadId,
  setSelectedThreadId,
  router,
}: {
  threadParamRaw: string | string[] | undefined;
  threads: EmailThread[];
  threadsLoading: boolean;
  selectedThreadId: string | null;
  setSelectedThreadId: Dispatch<SetStateAction<string | null>>;
  router: Router;
}): void {
  useEffect(() => {
    if (threadsLoading) return;

    const threadFromUrl = normalizeInboxThreadParam(threadParamRaw);
    const inList = (id: string) => threads.some((t) => t.id === id);

    if (threadFromUrl && !inList(threadFromUrl)) {
      router.replace({ pathname: '/inbox', params: {} });
      if (selectedThreadId === threadFromUrl) {
        setSelectedThreadId(null);
      }
      return;
    }

    if (selectedThreadId && threadFromUrl !== selectedThreadId) {
      // Use setParams so the URL updates without a full replace — replace can remount
      // the screen and reset inbox state, which then auto-selects the first thread.
      router.setParams({ thread: selectedThreadId });
      return;
    }

    if (!selectedThreadId && threadFromUrl && inList(threadFromUrl)) {
      setSelectedThreadId(threadFromUrl);
    }
  }, [
    threadParamRaw,
    threads,
    threadsLoading,
    selectedThreadId,
    setSelectedThreadId,
    router,
  ]);
}
