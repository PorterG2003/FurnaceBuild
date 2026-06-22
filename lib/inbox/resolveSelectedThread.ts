import type { EmailThread } from '@/lib/supabase/types';

export function resolveSelectedThread(
  threads: EmailThread[],
  selectedThreadId: string | null,
  fetchedThread: EmailThread | null,
): EmailThread | undefined {
  if (!selectedThreadId) return undefined;
  return threads.find((t) => t.id === selectedThreadId) ?? fetchedThread ?? undefined;
}
