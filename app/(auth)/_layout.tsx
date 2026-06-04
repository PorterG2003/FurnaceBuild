import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { AppBootScreen } from '@/components/ui/AppBootScreen';

export default function AuthLayout() {
  const { user, loading, isRecoverySession } = useAuth();
  const router = useRouter();
  const { invitation_id, amendment_id } = useLocalSearchParams<{
    invitation_id?: string;
    amendment_id?: string;
  }>();

  // Normalize /auth/ → /auth on web so trailing-slash requests don't break (server may 404 on /auth/)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const path = window.location.pathname;
    if (path === '/auth/') {
      const search = window.location.search || '';
      const hash = window.location.hash || '';
      router.replace(`/auth${search}${hash}`);
    }
  }, [router]);

  useEffect(() => {
    if (loading) return;
    if (user && !isRecoverySession) {
      if (invitation_id) {
        router.replace(`/accept-invitation/${invitation_id}`);
      } else if (amendment_id) {
        router.replace(`/accept-account-amendment/${amendment_id}`);
      } else {
        router.replace('/');
      }
    }
  }, [user, loading, isRecoverySession, router, invitation_id, amendment_id]);

  if (loading) return <AppBootScreen />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
