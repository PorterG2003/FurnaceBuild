import React from 'react';
import { Text, Pressable } from 'react-native';
import { FormCard } from '@/components/ui/forms';

interface ConfirmSignUpFormProps {
  email: string;
  password: string;
  onSuccess: () => void;
  onBackToSignIn: () => void;
}

/**
 * Supabase sends a confirmation link by email. The link redirects to the invite
 * accept page (via emailRedirectTo), which confirms the session and joins the workspace.
 * The button below is a same-tab fallback if the user already confirmed elsewhere.
 */
export function ConfirmSignUpForm({ email, onSuccess, onBackToSignIn }: ConfirmSignUpFormProps) {
  return (
    <FormCard>
      <Text className="text-3xl font-instrument-semibold mb-2 text-center text-white">
        Check Your Email
      </Text>
      <Text className="text-center text-gray-300 mb-8 font-instrument">
        We sent a confirmation link to {email}. Click the link to verify your account and join your
        workspace. You can use this page again after confirming if you still have this tab open.
      </Text>

      <Pressable
        onPress={onSuccess}
        className="mb-4 bg-brand-orange rounded-xl py-4 items-center border border-[rgba(248,81,2,0.3)]"
      >
        <Text className="text-white font-instrument-medium">Continue</Text>
      </Pressable>

      <Pressable onPress={onBackToSignIn}>
        <Text className="text-center text-gray-300 font-instrument-medium">
          Back to Sign In
        </Text>
      </Pressable>
    </FormCard>
  );
}
