/**
 * Inbox URL helpers.
 *
 * - Thread id: path segment `/inbox/{threadId}` (canonical; parsed via parseInboxThreadIdFromPathname).
 * - Workspace is resolved from the thread id at runtime (no accountId in URLs).
 * - Legacy: `?thread=` on `/inbox` (redirect once to path form); old `?accountId=` is stripped on load.
 */
import type { AppRouteHref } from '@/lib/navigation/appRoutePath';

export const INBOX_LIST_PATH = '/inbox';
export const INBOX_THREAD_PATH = '/inbox/[threadId]';

export type ParsedInboxUrl = {
  threadId: string | null;
  /** Legacy query param; parsed for old notification links only. */
  accountId: string | null;
};

/** `useLocalSearchParams` may return `string | string[]` for a query key. */
export function normalizeRouteParam(value: string | string[] | undefined): string | undefined {
  if (value == null) return undefined;
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function buildInboxListHref(): AppRouteHref {
  return INBOX_LIST_PATH;
}

export function buildInboxThreadHref(threadId: string): AppRouteHref {
  return buildInboxThreadPath(threadId);
}

export function buildInboxThreadPath(threadId: string): string {
  return `${INBOX_LIST_PATH}/${encodeURIComponent(threadId)}`;
}

/** In-app navigation: same as buildInboxThreadPath (path only, no query). */
export function buildInboxInternalThreadHref(threadId: string): AppRouteHref {
  return buildInboxThreadPath(threadId);
}

export function isReplaceLeadInboxPath(pathname: string | null | undefined): boolean {
  return pathname === `${INBOX_LIST_PATH}/replace-lead` || pathname?.endsWith('/replace-lead') === true;
}

/** Remove redundant query params when thread is already in the path segment. */
export function cleanInboxThreadUrlOnWeb(pathname: string | null | undefined): void {
  if (typeof window === 'undefined' || !pathname) return;
  const threadFromPath = parseInboxThreadIdFromPathname(pathname);
  if (!threadFromPath) return;
  const u = new URL(window.location.href);
  let changed = false;
  for (const key of ['threadId', 'screen', 'params', 'accountId']) {
    if (u.searchParams.has(key)) {
      u.searchParams.delete(key);
      changed = true;
    }
  }
  if (!changed) return;
  const qs = u.searchParams.toString();
  window.history.replaceState(null, '', qs ? `${u.pathname}?${qs}` : u.pathname);
}

export function isInboxPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === INBOX_LIST_PATH || pathname.startsWith(`${INBOX_LIST_PATH}/`);
}

/** Thread id from `/inbox/{threadId}`; null for list, replace-lead, or non-inbox paths. */
export function parseInboxThreadIdFromPathname(pathname: string | null | undefined): string | null {
  if (!pathname || pathname === INBOX_LIST_PATH) return null;
  const prefix = `${INBOX_LIST_PATH}/`;
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).split('/')[0];
  if (!segment || segment === 'replace-lead') return null;
  return decodeURIComponent(segment);
}

/** Whether route access may switch workspace to match the URL thread (external entry). */
export function shouldAllowInboxAccountSwitch(params: { routeThreadChanged: boolean }): boolean {
  return params.routeThreadChanged;
}

/** Skip fetch when thread is already in the loaded list for the current workspace. */
export function canUseInternalInboxRouteAccess(params: {
  routeThreadId: string | null;
  loadedThreadIds: string[];
  loadedForAccountId: string | null;
  currentAccountId: string | null;
}): boolean {
  const { routeThreadId, loadedThreadIds, loadedForAccountId, currentAccountId } = params;
  if (!routeThreadId) return false;
  if (!currentAccountId || loadedForAccountId !== currentAccountId) return false;
  return loadedThreadIds.includes(routeThreadId);
}

/** Legacy `?thread=` search params on `/inbox`. */
export function parseLegacyInboxSearchParams(search: string): ParsedInboxUrl | null {
  const normalized = search.startsWith('?') ? search.slice(1) : search;
  if (!normalized.trim()) return null;
  const params = new URLSearchParams(normalized);
  const threadId = params.get('thread');
  if (!threadId) return null;
  return {
    threadId,
    accountId: params.get('accountId'),
  };
}

/**
 * Parse inbox thread from an action URL or absolute URL.
 * Supports path-based `/inbox/{threadId}` and legacy `/inbox?thread=`.
 */
export function parseInboxNotificationUrl(rawUrl: string): ParsedInboxUrl | null {
  if (!rawUrl?.trim()) return null;
  try {
    const u = new URL(rawUrl, 'https://local.invalid');
    if (u.pathname !== INBOX_LIST_PATH && !u.pathname.startsWith(`${INBOX_LIST_PATH}/`)) {
      return null;
    }

    const accountId = u.searchParams.get('accountId');

    const legacyThread = u.searchParams.get('thread');
    if (legacyThread && u.pathname === INBOX_LIST_PATH) {
      return { threadId: legacyThread, accountId };
    }

    const prefix = `${INBOX_LIST_PATH}/`;
    if (u.pathname.startsWith(prefix)) {
      const segment = u.pathname.slice(prefix.length).split('/')[0];
      if (segment && segment !== 'replace-lead') {
        return { threadId: decodeURIComponent(segment), accountId };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function resolveInboxRouteAccess(params: {
  routeThreadId: string | null;
  currentAccountId: string | null;
  membershipAccountIds: string[];
  threadAccountId: string | null;
  threadExists: boolean;
}): {
  status: 'list_only' | 'ready' | 'denied';
  targetAccountId: string | null;
  reason?: 'not_member' | 'thread_not_found';
} {
  const { routeThreadId, currentAccountId, membershipAccountIds, threadAccountId, threadExists } =
    params;

  if (!routeThreadId) {
    return { status: 'list_only', targetAccountId: currentAccountId };
  }

  if (!threadExists || !threadAccountId) {
    return {
      status: 'denied',
      targetAccountId: currentAccountId,
      reason: 'thread_not_found',
    };
  }

  if (!membershipAccountIds.includes(threadAccountId)) {
    return { status: 'denied', targetAccountId: threadAccountId, reason: 'not_member' };
  }

  return { status: 'ready', targetAccountId: threadAccountId };
}
