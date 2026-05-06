import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';

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
  return getIsWebStandalone() || isDesktopViewportWidth(viewportWidth);
}

export function normalizeInstallGatePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function isPublicInstallRoute(pathname: string): boolean {
  return normalizeInstallGatePathname(pathname) === '/install';
}
