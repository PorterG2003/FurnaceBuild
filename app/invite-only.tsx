import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/forms';
import { LoadingState, Alert } from '@/components/ui/feedback';
import { HeroHeatShimmer, EmberParticlesLite } from '@/components/ui/effects';
import { Logo } from '@/components/ui/branding';
import { HELP_EMAIL, HELP_EMAIL_URL, HELP_SCHEDULE_URL } from '@/components/ui/help/HelpModal';
import { authInputClassName, authInputStyle, authLabelClassName, authPlaceholderColor } from '@/components/auth/authFormStyles';
import { useSelfServeGuidance } from '@/hooks/useSelfServeGuidance';

export default function InviteOnlyPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const initialEmail = useMemo(() => (typeof emailParam === 'string' ? emailParam : ''), [emailParam]);
  const [emailInput, setEmailInput] = useState(initialEmail);
  const [submittedEmail, setSubmittedEmail] = useState(initialEmail || null);
  const { data, loading, error } = useSelfServeGuidance(submittedEmail);

  const primaryActionLabel = data?.primary_cta === 'email_support' ? 'Email support' : 'Book a call';
  const primaryAction = () => {
    if (data?.primary_cta === 'email_support') {
      void Linking.openURL(HELP_EMAIL_URL);
      return;
    }
    void Linking.openURL(HELP_SCHEDULE_URL);
  };

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
            <View style={{ height: 16 }} />
            <View className="w-full overflow-hidden rounded-2xl border border-[#2A2A2A] bg-[#121212]">
              <FormCard>
                <Text className="text-3xl font-instrument-semibold mb-2 text-center text-white">
                  Furnace Is Invite Only
                </Text>
                <Text className="text-center text-gray-300 mb-6 font-instrument">
                  Look in your email for an invite link. If you are new to Furnace, book a call to get started.
                </Text>

                <View className="mb-4">
                  <Text className={authLabelClassName}>Work Email</Text>
                  <TextInput
                    value={emailInput}
                    onChangeText={setEmailInput}
                    placeholder="Enter your email"
                    placeholderTextColor={authPlaceholderColor}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    className={authInputClassName}
                    style={authInputStyle}
                    selectionColor="#FF4D00"
                    underlineColorAndroid="transparent"
                    autoComplete="email"
                  />
                </View>

                <Button
                  className="mb-4"
                  onPress={() => setSubmittedEmail(emailInput.trim().toLowerCase() || null)}
                >
                  Continue
                </Button>

                {loading ? <LoadingState message="Checking your access path..." size="small" className="py-6" /> : null}
                {error ? <Alert variant="error" message={error} className="mb-4" /> : null}

                {data && !loading ? (
                  <View className="gap-3">
                    <View className="rounded-xl border border-[#2A2A2A] bg-[#181818] p-4">
                      <Text className="text-white font-instrument-medium mb-2">
                        {data.is_known ? 'Existing prospect or customer' : 'New to Furnace'}
                      </Text>
                      <Text className="text-gray-300 font-instrument">
                        {data.is_known
                          ? `Please email ${HELP_EMAIL} and we will help you find the right invite or billing access.`
                          : 'Book a time with Furnace and we will walk you through managed onboarding.'}
                      </Text>
                    </View>

                    <Button onPress={primaryAction}>{primaryActionLabel}</Button>
                    <Button variant="outline" onPress={() => router.replace('/auth')}>
                      I already have an invite
                    </Button>
                  </View>
                ) : null}
              </FormCard>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
