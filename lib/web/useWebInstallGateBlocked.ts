import { useEffect, useMemo, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { shouldBypassWebInstallGate } from '@/lib/web/installGate';
import { INSTALL_GATE_SKIP_CHANGED_EVENT } from '@/lib/web/installGateSkip';

/**
 * On web: true when the user is in a normal mobile browser tab (narrow viewport,
 * not standalone) and has not Continue'd / Always-dismissed the install gate.
 * Native platforms are never blocked.
 */
export function useWebInstallGateBlocked(): boolean {
  const { width } = useWindowDimensions();
  const [displayModeTick, setDisplayModeTick] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const bump = () => setDisplayModeTick((t) => t + 1);
    let mqStandalone: MediaQueryList | null = null;
    let mqFullscreen: MediaQueryList | null = null;

    try {
      mqStandalone = window.matchMedia('(display-mode: standalone)');
      mqFullscreen = window.matchMedia('(display-mode: fullscreen)');
      mqStandalone.addEventListener('change', bump);
      mqFullscreen.addEventListener('change', bump);
    } catch {
      /* ignore */
    }

    window.addEventListener('resize', bump);
    window.addEventListener(INSTALL_GATE_SKIP_CHANGED_EVENT, bump);
    return () => {
      window.removeEventListener('resize', bump);
      window.removeEventListener(INSTALL_GATE_SKIP_CHANGED_EVENT, bump);
      try {
        mqStandalone?.removeEventListener('change', bump);
        mqFullscreen?.removeEventListener('change', bump);
      } catch {
        /* ignore */
      }
    };
  }, []);

  return useMemo(() => {
    if (Platform.OS !== 'web') return false;

    // Prefer live innerWidth when available so first paint matches the browser before RN layout settles.
    const viewportWidth =
      typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : width;

    // Re-run when display-mode / skip-storage listeners bump this.
    void displayModeTick;

    return !shouldBypassWebInstallGate(viewportWidth);
  }, [width, displayModeTick]);
}
