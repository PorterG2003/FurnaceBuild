import { useEffect } from 'react';
import { useRouter, usePathname } from 'expo-router';
import { useAuthenticator } from '@aws-amplify/ui-react-native';

// Define public routes that don't need authentication
const PUBLIC_ROUTES = [
  '/auth',
  '/auth/',
];

export function useAuthGuard() {
  const { user, authStatus } = useAuthenticator();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Check if current route is public
    const isPublicRoute = PUBLIC_ROUTES.some(route => 
      pathname === route || pathname.startsWith(route)
    );

    // Only redirect if we have a definitive auth state
    if (authStatus === 'unauthenticated' && !isPublicRoute) {
      router.replace('/auth');
    } else if (authStatus === 'authenticated' && isPublicRoute) {
      router.replace('/');
    }
  }, [authStatus, pathname, router]);

  return {
    user,
    authStatus,
    isAuthenticated: authStatus === 'authenticated',
  };
}
