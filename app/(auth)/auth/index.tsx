import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { SignInForm } from '@/components/auth/SignInForm';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { ConfirmSignUpForm } from '@/components/auth/ConfirmSignUpForm';
import { ConfirmResetPasswordForm } from '@/components/auth/ConfirmResetPasswordForm';
import { HeroHeatShimmer, EmberParticlesLite } from '@/components/ui/effects';

type AuthState = 'signIn' | 'signUp' | 'confirmSignUp' | 'forgotPassword' | 'confirmResetPassword';

export default function AuthIndex() {
  const router = useRouter();
  const { invitation_id, email: inviteEmail, mode } = useLocalSearchParams<{
    invitation_id?: string;
    email?: string;
    mode?: string;
  }>();
  const { user, isRecoverySession, clearRecoverySession } = useAuth();
  const [authState, setAuthState] = useState<AuthState>(
    isRecoverySession ? 'confirmResetPassword' : mode === 'signUp' ? 'signUp' : 'signIn',
  );
  const [signUpData, setSignUpData] = useState<{ email: string; password: string } | null>(null);
  const [forgotPasswordData, setForgotPasswordData] = useState<{ email: string } | null>(null);
  const [signInSuccessMessage, setSignInSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isRecoverySession && user) {
      setForgotPasswordData({ email: user.email ?? '' });
      setAuthState('confirmResetPassword');
    }
  }, [isRecoverySession, user]);

  const handleSignUpSuccess = (email: string, password: string) => {
    setSignUpData({ email, password });
    setAuthState('confirmSignUp');
  };

  const handleVerificationSuccess = () => {
    if (invitation_id) {
      router.replace(`/accept-invitation/${invitation_id}`);
    } else {
      router.replace('/');
    }
  };

  const handleBackToSignIn = () => {
    setAuthState('signIn');
    setSignUpData(null);
    setForgotPasswordData(null);
  };

  const handleGoToSignUp = () => {
    setAuthState('signUp');
  };

  const handleGoToForgotPassword = () => {
    setAuthState('forgotPassword');
    setForgotPasswordData(null);
    setSignInSuccessMessage(null);
  };

  const handleBackToSignInFromForgot = () => {
    setAuthState('signIn');
    setForgotPasswordData(null);
    clearRecoverySession();
  };

  const handleForgotPasswordCodeSent = (email: string) => {
    setForgotPasswordData({ email });
    setAuthState('confirmResetPassword');
  };

  const handleResetPasswordSuccess = () => {
    setForgotPasswordData(null);
    clearRecoverySession();
  };

  const renderForm = () => {
    switch (authState) {
      case 'signIn':
        return (
          <SignInForm
            onGoToSignUp={handleGoToSignUp}
            onGoToForgotPassword={handleGoToForgotPassword}
            initialSuccessMessage={signInSuccessMessage ?? undefined}
          />
        );
      case 'signUp':
        return (
          <SignUpForm
            onSignUpSuccess={handleSignUpSuccess}
            onBackToSignIn={handleBackToSignIn}
            initialEmail={inviteEmail}
          />
        );
      case 'forgotPassword':
        return (
          <ForgotPasswordForm
            onBackToSignIn={handleBackToSignInFromForgot}
            onCodeSent={handleForgotPasswordCodeSent}
          />
        );
      case 'confirmResetPassword':
        return forgotPasswordData || isRecoverySession ? (
          <ConfirmResetPasswordForm
            email={forgotPasswordData?.email ?? ''}
            onSuccess={handleResetPasswordSuccess}
            onBackToSignIn={() => {
              setAuthState('signIn');
              setForgotPasswordData(null);
              clearRecoverySession();
            }}
            isRecoverySession={isRecoverySession}
          />
        ) : (
          <SignInForm
            onGoToSignUp={handleGoToSignUp}
            onGoToForgotPassword={handleGoToForgotPassword}
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
      <HeroHeatShimmer
        intensity="low"
        speed="slow"
        tint="ember"
        className="flex-1"
      >
        {renderForm()}
      </HeroHeatShimmer>
      <EmberParticlesLite density="low" maxOpacity={0.06} />
    </>
  );
}
