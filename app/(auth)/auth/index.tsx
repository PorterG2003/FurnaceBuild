import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { SignInForm } from '@/components/auth/SignInForm';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { ConfirmSignUpForm } from '@/components/auth/ConfirmSignUpForm';
import { ConfirmResetPasswordForm } from '@/components/auth/ConfirmResetPasswordForm';
import { HeroHeatShimmer, EmberParticlesLite } from '@/components/ui/effects';
import { Logo } from '@/components/ui/branding';
import { HELP_SCHEDULE_URL } from '@/components/ui/help/HelpModal';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { usePublicAccessDialog } from '@/hooks/usePublicAccessDialog';

type AuthState = 'signIn' | 'signUp' | 'confirmSignUp' | 'forgotPassword' | 'confirmResetPassword';

function openScheduleUrl() {
  void Linking.openURL(HELP_SCHEDULE_URL);
}

export default function AuthIndex() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const showBrandPanel = width >= LAYOUT_BREAKPOINT;
  const { invitation_id, amendment_id, email: inviteEmail, mode } = useLocalSearchParams<{
    invitation_id?: string;
    amendment_id?: string;
    email?: string;
    mode?: string;
  }>();
  const allowInvitationSignUp = Boolean(invitation_id);
  const { user, isRecoverySession, clearRecoverySession } = useAuth();
  const [authState, setAuthState] = useState<AuthState>(
    isRecoverySession ? 'confirmResetPassword' : (allowInvitationSignUp && mode === 'signUp' ? 'signUp' : 'signIn'),
  );
  const [signUpData, setSignUpData] = useState<{ email: string; password: string } | null>(null);
  const [forgotPasswordData, setForgotPasswordData] = useState<{ email: string } | null>(null);
  const [signInSuccessMessage, setSignInSuccessMessage] = useState<string | null>(null);

  usePublicAccessDialog('auth');

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
    } else if (amendment_id) {
      router.replace(`/accept-account-amendment/${amendment_id}`);
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
    if (!allowInvitationSignUp) return;
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
            onGoToForgotPassword={handleGoToForgotPassword}
            initialSuccessMessage={signInSuccessMessage ?? undefined}
            showSignUp={allowInvitationSignUp}
            onGoToSignUp={allowInvitationSignUp ? handleGoToSignUp : undefined}
            onRequestAccess={!allowInvitationSignUp ? openScheduleUrl : undefined}
          />
        );
      case 'signUp':
        if (!allowInvitationSignUp) {
          return (
            <SignInForm
              onGoToForgotPassword={handleGoToForgotPassword}
              showSignUp={false}
              onRequestAccess={openScheduleUrl}
            />
          );
        }
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
            onGoToForgotPassword={handleGoToForgotPassword}
            showSignUp={allowInvitationSignUp}
            onGoToSignUp={allowInvitationSignUp ? handleGoToSignUp : undefined}
            onRequestAccess={!allowInvitationSignUp ? openScheduleUrl : undefined}
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
            onGoToForgotPassword={handleGoToForgotPassword}
            showSignUp={allowInvitationSignUp}
            onGoToSignUp={allowInvitationSignUp ? handleGoToSignUp : undefined}
            onRequestAccess={!allowInvitationSignUp ? openScheduleUrl : undefined}
          />
        );
      default:
        return (
          <SignInForm
            onGoToForgotPassword={handleGoToForgotPassword}
            showSignUp={allowInvitationSignUp}
            onGoToSignUp={allowInvitationSignUp ? handleGoToSignUp : undefined}
            onRequestAccess={!allowInvitationSignUp ? openScheduleUrl : undefined}
          />
        );
    }
  };

  if (showBrandPanel) {
    return (
      <View className="flex-1 min-h-full flex-row bg-[#121212]">
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
        <View className="flex-1 min-h-full min-w-0 w-full max-w-[680px] border-l border-[#2A2A2A] bg-[#121212]">
          {renderForm()}
        </View>
      </View>
    );
  }

  /** Fixed gap between logo bottom and card top (matches prior layout: 16px). */
  const logoToCardGap = 16;

  return (
    <View className="min-h-full flex-1 bg-[#121212]">
      <View className="absolute inset-0">
        <HeroHeatShimmer
          intensity="low"
          speed="slow"
          tint="ember"
          className="absolute inset-0"
          midground={<EmberParticlesLite density="low" maxOpacity={0.06} />}
        />
      </View>
      <KeyboardAvoidingView
        className="min-h-full flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 16,
            paddingTop: insets.top + 16,
            paddingBottom: Math.max(insets.bottom, 16) + 16,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="mx-auto w-full max-w-md items-center">
            <View className="w-full max-w-[220px] items-center">
              <Logo className="mb-0" variant="white" maxWidth={220} />
            </View>
            <View style={{ height: logoToCardGap }} />
            <View className="w-full overflow-hidden rounded-2xl border border-[#2A2A2A] bg-[#121212]">
              {renderForm()}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
