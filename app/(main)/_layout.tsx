import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Stack, usePathname, useRouter, type Href } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useAccount } from '@/contexts/AccountContext';
import { NotificationToastSubscriber } from '@/components/notifications/NotificationToastSubscriber';
import { AppBootScreen } from '@/components/ui/AppBootScreen';
import { Button } from '@/components/ui/button';
import { HELP_EMAIL } from '@/components/ui/help/HelpModal';

/** Same `type` string as public/sw.js postMessage fallback when WindowClient.navigate is missing. */
const SW_NAVIGATE_MESSAGE_TYPE = 'furnace-notification-navigate';

function WebPushNavigationBridge() {
  const router = useRouter();
  const { memberships, setCurrentAccountId } = useAccount();

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
        const accountId = u.searchParams.get('accountId');
        if (accountId && memberships.some((m) => m.account.id === accountId)) {
          setCurrentAccountId(accountId);
        }
        u.searchParams.delete('accountId');
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
  }, [memberships, router, setCurrentAccountId]);

  return null;
}

function PaymentRequiredScreen() {
  const { signOut } = useAuth();
  return (
    <View className="flex-1 items-center justify-center bg-[#121212] px-6">
      <View className="w-full max-w-lg rounded-2xl border border-[#2A2A2A] bg-[#181818] p-6">
        <Text className="text-center text-3xl font-instrument-semibold text-white mb-3">
          Payment Required
        </Text>
        <Text className="text-center text-gray-300 font-instrument mb-6">
          Your workspace is active, but customer access is temporarily blocked until billing is resolved. Email {HELP_EMAIL} and we will help you restore access.
        </Text>
        <Button className="mb-3" onPress={() => { void signOut(); }}>
          Sign Out
        </Button>
      </View>
    </View>
  );
}

function MainAccessGate() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { memberships, loading, initialized, platformAdminAccess, isFrontendBlocked } = useAccount();
  const allowAdminWithoutWorkspace = platformAdminAccess === 'allowed' && (pathname === '/admin' || pathname?.startsWith('/admin/'));
  const showLoadingOverlay = !initialized || loading || platformAdminAccess === 'loading';

  useEffect(() => {
    if (!initialized) return;
    if (loading) return;
    if (platformAdminAccess === 'loading') return;
    if (!memberships.length && !allowAdminWithoutWorkspace) {
      router.replace({
        pathname: '/invite-only',
        params: user?.email ? { email: user.email } : {},
      });
    }
  }, [allowAdminWithoutWorkspace, initialized, loading, memberships.length, platformAdminAccess, router, user?.email]);

  if (!showLoadingOverlay && !memberships.length && !allowAdminWithoutWorkspace) {
    return <AppBootScreen />;
  }

  if (!showLoadingOverlay && isFrontendBlocked && platformAdminAccess !== 'allowed') {
    return <PaymentRequiredScreen />;
  }

  return (
    <>
      <WebPushNavigationBridge />
      <NotificationToastSubscriber />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
      {showLoadingOverlay ? (
        <View pointerEvents="auto" style={StyleSheet.absoluteFillObject}>
          <AppBootScreen />
        </View>
      ) : null}
    </>
  );
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

  return <MainAccessGate />;
}
