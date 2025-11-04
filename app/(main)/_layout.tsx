import { Stack } from 'expo-router';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { BackgroundProvider } from '@/contexts/BackgroundContext';

export default function MainLayout() {
  const { isAuthenticated } = useAuthGuard();

  return (
    <BackgroundProvider>
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
    </BackgroundProvider>
  );
}

