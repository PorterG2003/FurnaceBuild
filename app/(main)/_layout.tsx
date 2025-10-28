import { Stack } from 'expo-router';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function MainLayout() {
  const { user } = useAuthenticator();
  const router = useRouter();

  useEffect(() => {
    if (!user) {
      router.replace('/(auth)/');
    }
  }, [user]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}

