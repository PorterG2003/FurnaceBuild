import { Stack } from 'expo-router';
import { useAuthGuard } from '@/hooks/useAuthGuard';

export default function AuthLayout() {
  const { isAuthenticated } = useAuthGuard();

  // The auth guard handles redirects automatically
  // If user is authenticated, they'll be redirected to main app
  // If user is not authenticated, they can access auth pages

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
