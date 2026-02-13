import { Stack } from 'expo-router';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { AccountProvider } from '@/contexts/AccountContext';

export default function MainLayout() {
  useAuthGuard();

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

