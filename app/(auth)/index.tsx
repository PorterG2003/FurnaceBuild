import { View } from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { SignInForm } from '@/components/auth/SignInForm';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { ConfirmSignUpForm } from '@/components/auth/ConfirmSignUpForm';
import HeroHeatShimmer from '@/components/ui/HeroHeatShimmer';
import EmberParticlesLite from '@/components/ui/EmberParticlesLite';

export default function AuthIndex() {
  const { user, route } = useAuthenticator();
  const router = useRouter();

  useEffect(() => {
    if (user) {
      router.replace('/(main)/');
    }
  }, [user]);

  // Render different forms based on the current route
  const renderForm = () => {
    switch (route) {
      case 'signIn':
        return <SignInForm />;
      case 'signUp':
        return <SignUpForm />;
      case 'forgotPassword':
        return <ForgotPasswordForm />;
      case 'confirmSignUp':
        return <ConfirmSignUpForm />;
      default:
        return <SignInForm />;
    }
  };

  return (
    <>
      {/* Background with heat shimmer effect */}
      <HeroHeatShimmer 
        intensity="low" 
        speed="slow" 
        tint="ember"
        className="flex-1"
      >
        {renderForm()}
      </HeroHeatShimmer>
      
      {/* Floating ember particles */}
      <EmberParticlesLite density="low" maxOpacity={0.06} />
    </>
  );
}
