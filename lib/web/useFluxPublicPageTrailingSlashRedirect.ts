import { useRouter } from 'expo-router';
import { useLayoutEffect } from 'react';
import { Platform } from 'react-native';
import { fluxPublicPageCanonicalPath } from './fluxPublicPageSlug';

/** Redirect `/p/{slug}/` → `/p/{slug}` before expo-router fails to match the route. */
export function useFluxPublicPageTrailingSlashRedirect(): void {
  const router = useRouter();

  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const target = fluxPublicPageCanonicalPath(
      window.location.pathname,
      window.location.search || '',
      window.location.hash || '',
    );
    if (!target) return;
    router.replace(target);
  }, [router]);
}
