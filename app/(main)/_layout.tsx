import { Stack } from 'expo-router';
import { useAuthGuard } from '@/hooks/useAuthGuard';

export default function MainLayout() {
  const { isAuthenticated } = useAuthGuard();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}

