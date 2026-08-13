import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { isMcpConsentPath, parseMcpConsentReturnTo } from '@/lib/mcp/consentReturn';
import { hasPublicAccessParams } from '@/lib/publicAccessState';
import {
  hasInstallGateAlwaysDismissLocal,
  hasInstallGateSessionContinue,
  parseSafeAppReturnTo,
} from '@/lib/web/installGateSkip';

/**
 * True when the web app is running as an installed PWA / standalone window
 * (not a normal browser tab).
 */
export function getIsWebStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  } catch {
    /* matchMedia unavailable */
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return false;
}

export function isDesktopViewportWidth(viewportWidth: number): boolean {
  return viewportWidth >= LAYOUT_BREAKPOINT;
}

/** When true, the install gate should not redirect away from the main app. */
export function shouldBypassWebInstallGate(viewportWidth: number): boolean {
  if (__DEV__) return true;
  if (getIsWebStandalone() || isDesktopViewportWidth(viewportWidth)) return true;
  if (hasInstallGateSessionContinue()) return true;
  if (hasInstallGateAlwaysDismissLocal()) return true;
  return false;
}

export function normalizeInstallGatePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function getCurrentWebPathname(fallbackPathname: string): string {
  if (typeof window !== 'undefined' && window.location.pathname) {
    return window.location.pathname;
  }
  return fallbackPathname;
}

/** Flux public prospect landing pages (`/p/{slug}`). */
export function isFluxPublicLandingRoute(pathname: string): boolean {
  const path = normalizeInstallGatePathname(pathname);
  return path === '/p' || path.startsWith('/p/');
}

/** Public onboarding accept routes that should stay reachable in mobile web. */
export function isPublicAcceptRoute(pathname: string): boolean {
  const path = normalizeInstallGatePathname(pathname);
  return (
    path === '/accept-invitation' ||
    path.startsWith('/accept-invitation/') ||
    path === '/accept-platform-invite' ||
    path.startsWith('/accept-platform-invite/') ||
    path === '/accept-account-amendment' ||
    path.startsWith('/accept-account-amendment/') ||
    isMcpConsentPath(path)
  );
}

/** Invite-scoped, MCP consent, or safe app return_to auth routes stay reachable until onboarding completes. */
export function isAuthInviteFlowRoute(pathname: string, search = ''): boolean {
  const path = normalizeInstallGatePathname(pathname);
  if (path !== '/auth') return false;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.has('invitation_id') || params.has('amendment_id')) return true;
  const returnTo = params.get('return_to');
  if (parseMcpConsentReturnTo(returnTo) != null) return true;
  return parseSafeAppReturnTo(returnTo) != null;
}

export function isPublicAccessDialogRoute(search = ''): boolean {
  return hasPublicAccessParams(search);
}

/** Routes that must not be redirected to `/install` on mobile web. */
export function isInstallGateExemptRoute(pathname: string, search = ''): boolean {
  const path = normalizeInstallGatePathname(pathname);
  if (path === '/install') return true;
  if (isFluxPublicLandingRoute(pathname)) return true;
  if (isPublicAcceptRoute(pathname)) return true;
  if (isAuthInviteFlowRoute(pathname, search)) return true;
  return isPublicAccessDialogRoute(search);
}

/** @deprecated Use {@link isInstallGateExemptRoute} */
export function isPublicInstallRoute(pathname: string): boolean {
  return isInstallGateExemptRoute(pathname);
}
