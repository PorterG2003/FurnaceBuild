import { useLayoutEffect } from 'react';
import { Platform } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { isInstallGateExemptRoute } from '@/lib/web/installGate';
import { useWebInstallGateBlocked } from '@/lib/web/useWebInstallGateBlocked';

/**
 * On mobile web (narrow viewport, not standalone), redirects all routes to `/install`.
 */
export function WebInstallGate() {
  const blocked = useWebInstallGateBlocked();
  const pathname = usePathname();
  const router = useRouter();
  const search = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.search : '';

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!blocked) return;
    if (isInstallGateExemptRoute(pathname, search)) return;
    router.replace('/install');
  }, [blocked, pathname, router, search]);

  return null;
}
