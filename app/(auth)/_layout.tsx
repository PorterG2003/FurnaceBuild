import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthLayout() {
  const { user, loading, isRecoverySession } = useAuth();
  const router = useRouter();
  const { invitation_id } = useLocalSearchParams<{ invitation_id?: string }>();

  useEffect(() => {
    if (loading) return;
    if (user && !isRecoverySession) {
      if (invitation_id) {
        router.replace(`/accept-invitation/${invitation_id}`);
      } else {
        router.replace('/');
      }
    }
  }, [user, loading, isRecoverySession, router, invitation_id]);

  if (loading) return null;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
