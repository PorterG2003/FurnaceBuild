import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { SignInForm } from '@/components/auth/SignInForm';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { ConfirmSignUpForm } from '@/components/auth/ConfirmSignUpForm';
import { ConfirmResetPasswordForm } from '@/components/auth/ConfirmResetPasswordForm';
import { HeroHeatShimmer, EmberParticlesLite } from '@/components/ui/effects';
import { Logo } from '@/components/ui/branding';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';

type AuthState = 'signIn' | 'signUp' | 'confirmSignUp' | 'forgotPassword' | 'confirmResetPassword';

export default function AuthIndex() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const showBrandPanel = width >= LAYOUT_BREAKPOINT;
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
    <View className="flex-1 min-h-full flex-row bg-[#121212]">
      {showBrandPanel ? (
        <View className="flex-1 min-h-full min-w-0 relative">
          <HeroHeatShimmer
            intensity="low"
            speed="slow"
            tint="ember"
            className="absolute inset-0"
            midground={<EmberParticlesLite density="low" maxOpacity={0.06} />}
          >
            <View className="flex-1 pt-7 pl-5 pr-4 pb-4">
              <View className="w-full max-w-[220px] self-start">
                <Logo className="mb-0" variant="white" maxWidth={220} />
              </View>
            </View>
          </HeroHeatShimmer>
        </View>
      ) : null}
      <View
        className={`flex-1 min-h-full min-w-0 w-full bg-[#121212] ${showBrandPanel ? 'max-w-[680px] border-l border-[#2A2A2A]' : ''}`}
      >
        {!showBrandPanel ? (
          <View className="w-full self-start px-5 pt-7 pb-2">
            <View className="max-w-[220px]">
              <Logo className="mb-0" variant="white" maxWidth={220} />
            </View>
          </View>
        ) : null}
        {renderForm()}
      </View>
    </View>
  );
}
