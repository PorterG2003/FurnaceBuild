import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Stack, usePathname, useRouter, type Href } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useAccount } from '@/contexts/AccountContext';
import { NotificationToastSubscriber } from '@/components/notifications/NotificationToastSubscriber';
import { OnboardingProvider } from '@/components/onboarding';
import { AppBootScreen } from '@/components/ui/AppBootScreen';
import { Button } from '@/components/ui/button';
import { HELP_EMAIL } from '@/components/ui/help/HelpModal';
import { TermsAcceptanceRequiredScreen } from '@/components/platform/amendment/TermsAcceptanceRequiredScreen';
import { PendingTermsBanner } from '@/components/platform/amendment/PendingTermsBanner';
import { usePublicAccessDialog } from '@/hooks/usePublicAccessDialog';
import {
  buildInboxThreadHref,
  parseInboxNotificationUrl,
} from '@/lib/inbox/inboxRoutes';

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
        const parsed = parseInboxNotificationUrl(`${u.pathname}${u.search}`);
        if (parsed?.threadId) {
          router.replace(buildInboxThreadHref(parsed.threadId) as Href);
          return;
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
  const {
    memberships,
    loading,
    initialized,
    platformAdminAccess,
    isFrontendBlocked,
    requiresTermsAcceptance,
    pendingAmendment,
    isAccountOwner,
    refetch,
  } = useAccount();
  const allowAdminWithoutWorkspace = platformAdminAccess === 'allowed' && (pathname === '/admin' || pathname?.startsWith('/admin/'));
  const allowAmendmentAcceptRoute = pathname?.startsWith('/accept-account-amendment/');
  const [recoveringWorkspace, setRecoveringWorkspace] = useState(false);
  const [redirectNoWorkspace, setRedirectNoWorkspace] = useState(false);
  const recoveryRunIdRef = useRef(0);
  const showLoadingOverlay =
    !initialized || loading || platformAdminAccess === 'loading' || recoveringWorkspace;

  useEffect(() => {
    if (!initialized) return;
    if (loading) return;
    if (platformAdminAccess === 'loading') return;
    if (memberships.length > 0 || allowAdminWithoutWorkspace) {
      setRecoveringWorkspace(false);
      setRedirectNoWorkspace(false);
      return;
    }
    if (redirectNoWorkspace) {
      router.replace('/no-workspace');
      return;
    }
    if (recoveringWorkspace) return;

    const runId = ++recoveryRunIdRef.current;
    setRecoveringWorkspace(true);

    void (async () => {
      const maxAttempts = 2;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (recoveryRunIdRef.current !== runId) return;
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const snapshot = await refetch();
        if (recoveryRunIdRef.current !== runId) return;
        if (snapshot?.memberships.length) {
          setRecoveringWorkspace(false);
          return;
        }
      }
      if (recoveryRunIdRef.current !== runId) return;
      setRecoveringWorkspace(false);
      setRedirectNoWorkspace(true);
    })();
  }, [
    allowAdminWithoutWorkspace,
    initialized,
    loading,
    memberships.length,
    platformAdminAccess,
    recoveringWorkspace,
    redirectNoWorkspace,
    refetch,
    router,
  ]);

  if (!showLoadingOverlay && !memberships.length && !allowAdminWithoutWorkspace && !recoveringWorkspace) {
    return (
      <View style={styles.flexFill}>
        <AppBootScreen />
      </View>
    );
  }

  if (
    !showLoadingOverlay &&
    requiresTermsAcceptance &&
    pendingAmendment &&
    !allowAmendmentAcceptRoute &&
    platformAdminAccess !== 'allowed'
  ) {
    return <TermsAcceptanceRequiredScreen pendingAmendment={pendingAmendment} />;
  }

  if (
    !showLoadingOverlay &&
    isFrontendBlocked &&
    platformAdminAccess !== 'allowed' &&
    !allowAmendmentAcceptRoute
  ) {
    return <PaymentRequiredScreen />;
  }

  return (
    <View style={styles.flexFill}>
      <WebPushNavigationBridge />
      <NotificationToastSubscriber />
      {!showLoadingOverlay &&
      pendingAmendment &&
      !isAccountOwner &&
      !allowAmendmentAcceptRoute &&
      platformAdminAccess !== 'allowed' ? (
        <PendingTermsBanner pendingAmendment={pendingAmendment} />
      ) : null}
      <OnboardingProvider enabled={!showLoadingOverlay}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: styles.stackContent,
          }}
        />
      </OnboardingProvider>
      {showLoadingOverlay ? (
        <View pointerEvents="auto" style={StyleSheet.absoluteFillObject}>
          <AppBootScreen />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flexFill: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#121212',
  },
  stackContent: {
    flex: 1,
    backgroundColor: '#121212',
  },
});

export default function MainLayout() {
  const { user, loading, isRecoverySession } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  usePublicAccessDialog('signed_in', {
    enabled: !!user && !loading && !isRecoverySession,
  });

  useEffect(() => {
    if (loading) return;
    if (!user || isRecoverySession) {
      router.replace('/auth');
    }
  }, [user, loading, isRecoverySession, router]);

  useEffect(() => {
    if (typeof document !== 'undefined') (document.activeElement as HTMLElement)?.blur();
  }, [pathname]);

  if (loading || !user || isRecoverySession) {
    return (
      <View style={styles.flexFill}>
        <AppBootScreen />
      </View>
    );
  }

  return <MainAccessGate />;
}
