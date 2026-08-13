/**
 * Mobile install-gate skip preferences + safe deep-link return paths.
 *
 * Continue = this Safari tab only (sessionStorage).
 * Always dismiss = localStorage mirror + users.web_install_gate_dismissed_at.
 */

export const INSTALL_GATE_SESSION_CONTINUE_KEY = 'furnace.webInstallGate.continueTab';
export const INSTALL_GATE_ALWAYS_DISMISS_KEY = 'furnace.webInstallGate.alwaysDismiss';
export const INSTALL_GATE_PENDING_RETURN_KEY = 'furnace.webInstallGate.pendingReturn';
/** Dispatched after Continue / Always dismiss so the gate re-reads storage. */
export const INSTALL_GATE_SKIP_CHANGED_EVENT = 'furnace-install-gate-skip-changed';

export function notifyInstallGateSkipChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(INSTALL_GATE_SKIP_CHANGED_EVENT));
}

function normalizeReturnPathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function canUseWebStorage(): boolean {
  return typeof window !== 'undefined';
}

function readStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
}

function removeStorage(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Relative in-app path (+ optional query/hash). Rejects open redirects and /install. */
export function parseSafeAppReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('//')) return null;
  if (!decoded.startsWith('/')) return null;

  const pathOnly = decoded.split('?')[0]?.split('#')[0] ?? '';
  const normalized = normalizeReturnPathname(pathOnly);
  if (normalized === '/install') return null;
  if (normalized === '/auth' || normalized.startsWith('/auth/')) return null;

  return decoded;
}

export function getCurrentWebHrefForInstallReturn(): string {
  if (!canUseWebStorage()) return '/';
  const path = window.location.pathname || '/';
  const search = window.location.search || '';
  const hash = window.location.hash || '';
  return `${path}${search}${hash}`;
}

export function stashInstallGatePendingReturn(href?: string): void {
  if (!canUseWebStorage()) return;
  const candidate = href ?? getCurrentWebHrefForInstallReturn();
  const safe = parseSafeAppReturnTo(candidate);
  if (!safe) return;
  writeStorage(window.sessionStorage, INSTALL_GATE_PENDING_RETURN_KEY, safe);
}

export function peekInstallGatePendingReturn(): string | null {
  if (!canUseWebStorage()) return null;
  return parseSafeAppReturnTo(readStorage(window.sessionStorage, INSTALL_GATE_PENDING_RETURN_KEY));
}

export function consumeInstallGatePendingReturn(fallback = '/'): string {
  const pending = peekInstallGatePendingReturn();
  if (canUseWebStorage()) {
    removeStorage(window.sessionStorage, INSTALL_GATE_PENDING_RETURN_KEY);
  }
  return pending ?? fallback;
}

export function hasInstallGateSessionContinue(): boolean {
  if (!canUseWebStorage()) return false;
  return readStorage(window.sessionStorage, INSTALL_GATE_SESSION_CONTINUE_KEY) === '1';
}

export function setInstallGateSessionContinue(): void {
  if (!canUseWebStorage()) return;
  writeStorage(window.sessionStorage, INSTALL_GATE_SESSION_CONTINUE_KEY, '1');
  notifyInstallGateSkipChanged();
}

export function hasInstallGateAlwaysDismissLocal(): boolean {
  if (!canUseWebStorage()) return false;
  return Boolean(readStorage(window.localStorage, INSTALL_GATE_ALWAYS_DISMISS_KEY));
}

export function setInstallGateAlwaysDismissLocal(isoTimestamp = new Date().toISOString()): void {
  if (!canUseWebStorage()) return;
  writeStorage(window.localStorage, INSTALL_GATE_ALWAYS_DISMISS_KEY, isoTimestamp);
  notifyInstallGateSkipChanged();
}

/**
 * Sync Always dismiss between localStorage and users.web_install_gate_dismissed_at.
 * Safe to call after profile load; no-ops when nothing to sync.
 */
export async function syncWebInstallGateDismissedPreference(
  userId: string,
  dismissedAtFromUser: string | null | undefined,
): Promise<void> {
  const localDismissed = hasInstallGateAlwaysDismissLocal();

  if (dismissedAtFromUser) {
    if (!localDismissed) {
      setInstallGateAlwaysDismissLocal(dismissedAtFromUser);
    }
    return;
  }

  if (!localDismissed) return;

  const iso =
    (canUseWebStorage() && readStorage(window.localStorage, INSTALL_GATE_ALWAYS_DISMISS_KEY)) ||
    new Date().toISOString();

  try {
    const { updateUserProfile } = await import('@/lib/supabase/services/accounts/users');
    await updateUserProfile(userId, { web_install_gate_dismissed_at: iso });
  } catch (err) {
    console.warn('[install-gate] failed to persist always-dismiss', err);
  }
}

/** Persist Always dismiss locally and, when logged in, on the user row. */
export async function markWebInstallGateAlwaysDismissed(userId: string | null): Promise<void> {
  const iso = new Date().toISOString();
  setInstallGateAlwaysDismissLocal(iso);
  if (!userId) return;
  try {
    const { updateUserProfile } = await import('@/lib/supabase/services/accounts/users');
    await updateUserProfile(userId, { web_install_gate_dismissed_at: iso });
  } catch (err) {
    console.warn('[install-gate] failed to persist always-dismiss', err);
  }
}

export function shouldShowIosSafariInstallSkipActions(env: {
  device: string;
  browser: string;
} | null): boolean {
  return env?.device === 'ios' && env?.browser === 'safari';
}

/** Build `/auth?return_to=…` for post-login deep links. Drops unsafe targets. */
export function buildAuthHrefWithReturnTo(returnTo: string | null | undefined): string {
  const safe = parseSafeAppReturnTo(returnTo);
  if (!safe) return '/auth';
  return `/auth?return_to=${encodeURIComponent(safe)}`;
}
