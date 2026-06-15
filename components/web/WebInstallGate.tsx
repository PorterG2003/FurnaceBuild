import { useLayoutEffect } from 'react';
import { Platform } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { getCurrentWebPathname, isInstallGateExemptRoute } from '@/lib/web/installGate';
import { useWebInstallGateBlocked } from '@/lib/web/useWebInstallGateBlocked';

/**
 * On mobile web (narrow viewport, not standalone), redirects all routes to `/install`.
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
    if (isInstallGateExemptRoute(currentPathname, search)) return;
    router.replace('/install');
  }, [blocked, currentPathname, router, search]);

  return null;
}
