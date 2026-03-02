import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { FormCard } from '@/components/ui/forms';

interface ConfirmSignUpFormProps {
  email: string;
  password: string;
  onSuccess: () => void;
  onBackToSignIn: () => void;
}

/**
 * Supabase sends a confirmation link by email. User clicks the link to confirm,
 * then signs in on the Sign In screen.
 */
export function ConfirmSignUpForm({ email, onSuccess, onBackToSignIn }: ConfirmSignUpFormProps) {
  return (
    <FormCard>
      <Text className="text-3xl font-instrument-semibold mb-2 text-center text-white">
        Check Your Email
      </Text>
      <Text className="text-center text-gray-300 mb-8 font-instrument">
        We sent a confirmation link to {email}. Click the link to verify your account, then sign in below.
      </Text>

      <Pressable
        onPress={onSuccess}
        className="mb-4 bg-brand-orange rounded-xl py-4 items-center border border-[rgba(248,81,2,0.3)]"
      >
        <Text className="text-white font-instrument-medium">Go to Sign In</Text>
      </Pressable>

      <Pressable onPress={onBackToSignIn}>
        <Text className="text-center text-gray-300 font-instrument-medium">
          Back to Sign In
        </Text>
      </Pressable>
    </FormCard>
  );
}
