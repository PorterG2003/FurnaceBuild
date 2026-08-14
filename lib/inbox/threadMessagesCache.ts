import {
  mergeNewestMessagesPage,
  mergeOlderMessagesPage,
  type MessageCursor,
  type ThreadMessagesPage,
} from '@/lib/inbox/messagePagination';
import type { EmailMessage } from '@/lib/supabase/types';

export type ThreadMessagesCacheEntry = {
  accountId: string;
  threadId: string;
  messages: EmailMessage[];
  hasOlder: boolean;
  oldestCursor: MessageCursor | null;
  fetchedAt: number;
};

type InflightKey = string;
type FetchPageFn = (
  threadId: string,
  options?: { limit?: number; before?: MessageCursor | null },
) => Promise<ThreadMessagesPage>;

const DEFAULT_PAGE_SIZE = 50;

const cache = new Map<string, ThreadMessagesCacheEntry>();
const inflight = new Map<InflightKey, Promise<ThreadMessagesPage>>();
let fetchPageImpl: FetchPageFn | null = null;

async function defaultFetchPage(
  threadId: string,
  options?: { limit?: number; before?: MessageCursor | null },
): Promise<ThreadMessagesPage> {
  const { getMessagesByThreadPage } = await import('@/lib/supabase/services/inbox/messages');
  return getMessagesByThreadPage(threadId, options);
}

function getFetchPage(): FetchPageFn {
  return fetchPageImpl ?? defaultFetchPage;
}

function entryKey(accountId: string, threadId: string): string {
  return `${accountId}:${threadId}`;
}

function initialInflightKey(accountId: string, threadId: string): InflightKey {
  return `${entryKey(accountId, threadId)}:initial`;
}

function olderInflightKey(accountId: string, threadId: string, before: MessageCursor): InflightKey {
  return `${entryKey(accountId, threadId)}:before:${before.receivedAt}:${before.id}`;
}

export function getCachedThreadMessages(
  accountId: string,
  threadId: string,
): ThreadMessagesCacheEntry | null {
  return cache.get(entryKey(accountId, threadId)) ?? null;
}

export function clearThreadMessagesCache(accountId?: string): void {
  if (!accountId) {
    cache.clear();
    inflight.clear();
    return;
  }
  const prefix = `${accountId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

function writeCache(
  accountId: string,
  threadId: string,
  messages: EmailMessage[],
  hasOlder: boolean,
  oldestCursor: MessageCursor | null,
): ThreadMessagesCacheEntry {
  const entry: ThreadMessagesCacheEntry = {
    accountId,
    threadId,
    messages,
    hasOlder,
    oldestCursor,
    fetchedAt: Date.now(),
  };
  cache.set(entryKey(accountId, threadId), entry);
  return entry;
}

async function fetchInitialPage(threadId: string, limit: number): Promise<ThreadMessagesPage> {
  return getFetchPage()(threadId, { limit, before: null });
}

/**
 * Load (or share an in-flight) newest page for a thread and store it in the account cache.
 * When `force` is false and a cache entry exists, returns the cached page shape without refetching.
 */
export async function loadInitialThreadMessages(
  accountId: string,
  threadId: string,
  options?: { limit?: number; force?: boolean },
): Promise<ThreadMessagesPage> {
  const limit = options?.limit ?? DEFAULT_PAGE_SIZE;
  const force = options?.force === true;
  const cached = getCachedThreadMessages(accountId, threadId);

  if (!force && cached) {
    return {
      messages: cached.messages,
      hasOlder: cached.hasOlder,
      oldestCursor: cached.oldestCursor,
      newestCursor:
        cached.messages.length > 0
          ? {
              receivedAt: cached.messages[cached.messages.length - 1]!.received_at,
              id: cached.messages[cached.messages.length - 1]!.id,
            }
          : null,
    };
  }

  const key = initialInflightKey(accountId, threadId);
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchInitialPage(threadId, limit).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, pending);
  }

  const page = await pending;

  // Re-read cache after the network round-trip so older pages loaded concurrently are kept.
  const latestCached = getCachedThreadMessages(accountId, threadId);
  if (force && latestCached && latestCached.messages.length > 0) {
    const merged = mergeNewestMessagesPage(latestCached.messages, page, latestCached.hasOlder);
    writeCache(accountId, threadId, merged.messages, merged.hasOlder, merged.oldestCursor);
    return {
      messages: merged.messages,
      hasOlder: merged.hasOlder,
      oldestCursor: merged.oldestCursor,
      newestCursor:
        merged.messages.length > 0
          ? {
              receivedAt: merged.messages[merged.messages.length - 1]!.received_at,
              id: merged.messages[merged.messages.length - 1]!.id,
            }
          : null,
    };
  }

  writeCache(accountId, threadId, page.messages, page.hasOlder, page.oldestCursor);
  return page;
}

/** Fire-and-forget prefetch that shares the same in-flight map as the real load. */
export function prefetchThreadMessages(accountId: string, threadId: string): void {
  if (getCachedThreadMessages(accountId, threadId)) return;
  void loadInitialThreadMessages(accountId, threadId).catch((err) => {
    console.error('Failed to prefetch thread messages:', err);
  });
}

export async function loadOlderThreadMessages(
  accountId: string,
  threadId: string,
  before: MessageCursor,
  options?: { limit?: number },
): Promise<ThreadMessagesPage> {
  const limit = options?.limit ?? DEFAULT_PAGE_SIZE;
  const key = olderInflightKey(accountId, threadId, before);
  let pending = inflight.get(key);
  if (!pending) {
    pending = getFetchPage()(threadId, { limit, before }).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, pending);
  }

  const page = await pending;
  const cached = getCachedThreadMessages(accountId, threadId);
  const existing = cached?.messages ?? [];
  const merged = mergeOlderMessagesPage(existing, page);
  writeCache(accountId, threadId, merged.messages, merged.hasOlder, merged.oldestCursor);
  return {
    messages: merged.messages,
    hasOlder: merged.hasOlder,
    oldestCursor: merged.oldestCursor,
    newestCursor:
      merged.messages.length > 0
        ? {
            receivedAt: merged.messages[merged.messages.length - 1]!.received_at,
            id: merged.messages[merged.messages.length - 1]!.id,
          }
        : null,
  };
}

/** Test-only helpers */
export function __resetThreadMessagesCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

export function __getThreadMessagesInflightSizeForTests(): number {
  return inflight.size;
}

export function __setFetchPageForTests(fn: FetchPageFn | null): void {
  fetchPageImpl = fn;
}
