import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { SignInForm } from '@/components/auth/SignInForm';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { ConfirmSignUpForm } from '@/components/auth/ConfirmSignUpForm';
import HeroHeatShimmer from '@/components/ui/HeroHeatShimmer';
import EmberParticlesLite from '@/components/ui/EmberParticlesLite';

type AuthState = 'signIn' | 'signUp' | 'confirmSignUp' | 'forgotPassword';

function AuthContent() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>('signIn');
  const [signUpData, setSignUpData] = useState<{ email: string; password: string } | null>(null);

  // Log current auth state
  console.log('🔐 AuthContent - Current state:', authState);

  const handleSignUpSuccess = (email: string, password: string) => {
    console.log('🔐 Sign up successful, moving to verification');
    setSignUpData({ email, password });
    setAuthState('confirmSignUp');
  };

  const handleVerificationSuccess = () => {
    console.log('🔐 Verification successful, redirecting to main app');
    router.replace('/');
  };

  const handleBackToSignIn = () => {
    console.log('🔐 Back to sign in');
    setAuthState('signIn');
    setSignUpData(null);
  };

  const handleGoToSignUp = () => {
    console.log('🔐 Go to sign up');
    setAuthState('signUp');
  };

  const handleGoToForgotPassword = () => {
    console.log('🔐 Go to forgot password');
    setAuthState('forgotPassword');
  };

  const handleBackToSignInFromForgot = () => {
    console.log('🔐 Back to sign in from forgot password');
    setAuthState('signIn');
  };

  // Render different forms based on the current auth state
  const renderForm = () => {
    switch (authState) {
      case 'signIn':
        return (
          <SignInForm 
            onGoToSignUp={handleGoToSignUp}
            onGoToForgotPassword={handleGoToForgotPassword}
          />
        );
      case 'signUp':
        return (
          <SignUpForm 
            onSignUpSuccess={handleSignUpSuccess}
            onBackToSignIn={handleBackToSignIn}
          />
        );
      case 'forgotPassword':
        return (
          <ForgotPasswordForm 
            onBackToSignIn={handleBackToSignInFromForgot}
          />
        );
      case 'confirmSignUp':
        return signUpData ? (
          <ConfirmSignUpForm 
            email={signUpData.email}
            password={signUpData.password}
            onSuccess={handleVerificationSuccess}
            onBackToSignIn={handleBackToSignIn}
          />
        ) : (
          <SignInForm 
            onGoToSignUp={handleGoToSignUp}
            onGoToForgotPassword={handleGoToForgotPassword}
          />
        );
      default:
        return (
          <SignInForm 
            onGoToSignUp={handleGoToSignUp}
            onGoToForgotPassword={handleGoToForgotPassword}
          />
        );
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

export default function AuthIndex() {
  return (
    <>
      {/* Background with heat shimmer effect */}
      <HeroHeatShimmer 
        intensity="low" 
        speed="slow" 
        tint="ember"
        className="flex-1"
      >
        <AuthContent />
      </HeroHeatShimmer>
      
      {/* Floating ember particles */}
      <EmberParticlesLite density="low" maxOpacity={0.06} />
    </>
  );
}
