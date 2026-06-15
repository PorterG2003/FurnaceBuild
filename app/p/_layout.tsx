import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/** Strip Amplify's trailing slash on `/p/{slug}/` so expo-router receives a stable slug param. */
export default function PublicProspectPageLayout() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const path = window.location.pathname;
    const match = path.match(/^\/p\/([^/]+)\/$/);
    if (!match) return;
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    router.replace(`/p/${match[1]}${search}${hash}`);
  }, [router]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
