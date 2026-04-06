import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, usePathname, useRouter, type Href } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { AccountProvider } from '@/contexts/AccountContext';
import { NotificationToastSubscriber } from '@/components/notifications/NotificationToastSubscriber';
import { AppBootScreen } from '@/components/ui/AppBootScreen';

/** Same `type` string as public/sw.js postMessage fallback when WindowClient.navigate is missing. */
const SW_NAVIGATE_MESSAGE_TYPE = 'furnace-notification-navigate';

function WebPushNavigationBridge() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== SW_NAVIGATE_MESSAGE_TYPE || typeof data.url !== 'string') return;
      try {
        const u = new URL(data.url);
        if (u.origin !== window.location.origin) return;
        if (u.pathname === '/inbox') {
          const thread = u.searchParams.get('thread');
          if (thread) {
            router.replace({ pathname: '/inbox', params: { thread } });
            return;
          }
        }
        router.replace(`${u.pathname}${u.search}` as Href);
      } catch {
        /* ignore malformed url */
      }
    };

    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [router]);

  return null;
}

export default function MainLayout() {
  const { user, loading, isRecoverySession } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user || isRecoverySession) {
      router.replace('/auth');
    }
  }, [user, loading, isRecoverySession, router]);

  useEffect(() => {
    if (typeof document !== 'undefined') (document.activeElement as HTMLElement)?.blur();
  }, [pathname]);

  if (loading || !user || isRecoverySession) return <AppBootScreen />;

  return (
    <AccountProvider>
      <WebPushNavigationBridge />
      <NotificationToastSubscriber />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </AccountProvider>
  );
}
