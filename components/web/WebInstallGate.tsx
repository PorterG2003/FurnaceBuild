import { useLayoutEffect } from 'react';
import { Platform } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import {
  getCurrentWebPathname,
  isInstallGateExemptRoute,
  shouldBypassWebInstallGate,
} from '@/lib/web/installGate';
import { stashInstallGatePendingReturn } from '@/lib/web/installGateSkip';
import { useWebInstallGateBlocked } from '@/lib/web/useWebInstallGateBlocked';

/**
 * On mobile web (narrow viewport, not standalone), redirects all routes to `/install`.
 * Stashes the intended deep link so Continue / Always dismiss can restore it.
 */
export function WebInstallGate() {
  const blocked = useWebInstallGateBlocked();
  const pathname = usePathname();
  const router = useRouter();
  const search = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.search : '';
  const currentPathname = Platform.OS === 'web' ? getCurrentWebPathname(pathname) : pathname;

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!blocked) return;
    // Re-check storage synchronously: Continue / Always dismiss may have just written
    // while React state from the skip event has not re-rendered yet.
    const viewportWidth =
      typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 0;
    if (shouldBypassWebInstallGate(viewportWidth)) return;
    if (isInstallGateExemptRoute(currentPathname, search)) return;
    stashInstallGatePendingReturn();
    router.replace('/install');
  }, [blocked, currentPathname, router, search]);

  return null;
}
