import { useEffect } from 'react';
import { Stack, usePathname, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { AccountProvider } from '@/contexts/AccountContext';
import { NotificationToastSubscriber } from '@/components/notifications/NotificationToastSubscriber';

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

  if (loading || !user || isRecoverySession) return null;

  return (
    <AccountProvider>
      <NotificationToastSubscriber />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </AccountProvider>
  );
}
