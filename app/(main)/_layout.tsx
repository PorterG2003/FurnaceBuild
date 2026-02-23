import { useEffect } from 'react';
import { Stack, usePathname } from 'expo-router';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { AccountProvider } from '@/contexts/AccountContext';

export default function MainLayout() {
  useAuthGuard();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof document !== 'undefined') (document.activeElement as HTMLElement)?.blur();
  }, [pathname]);

  return (
    <AccountProvider>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </AccountProvider>
  );
}

