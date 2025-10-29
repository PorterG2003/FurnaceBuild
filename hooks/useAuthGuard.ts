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

    console.log('🔐 Auth Guard - Pathname:', pathname);
    console.log('🔐 Auth Guard - Is public route:', isPublicRoute);
    console.log('🔐 Auth Guard - User:', !!user);
    console.log('🔐 Auth Guard - Auth status:', authStatus);

    // Only redirect if we have a definitive auth state
    if (authStatus === 'unauthenticated' && !isPublicRoute) {
      console.log('🔐 Auth Guard - User not authenticated, redirecting to auth');
      router.replace('/auth');
    } else if (authStatus === 'authenticated' && isPublicRoute) {
      console.log('🔐 Auth Guard - User authenticated, redirecting to main app');
      router.replace('/');
    } else {
      console.log('🔐 Auth Guard - Access allowed');
    }
  }, [authStatus, pathname, router]);

  return {
    user,
    authStatus,
    isAuthenticated: authStatus === 'authenticated',
  };
}
