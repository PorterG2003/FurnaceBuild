import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/forms';
import { useToast } from '@/components/ui/feedback';

interface ConfirmResetPasswordFormProps {
  email: string;
  onSuccess: () => void;
  onBackToSignIn: () => void;
  /** When true, user landed from the reset link and has a recovery session — show the set-new-password form. */
  isRecoverySession?: boolean;
}

const inputStyle = {
  borderColor: '#FFFFFF4D',
  backgroundColor: '#FFFFFF0D',
  color: '#FFFFFF',
  borderWidth: 1,
};

/**
 * Two modes:
 * 1. After requesting reset (isRecoverySession false): "Check your email" + Go to Sign In.
 * 2. After clicking reset link (isRecoverySession true): Set new password form; on submit calls updateUser({ password }) then onSuccess().
 */
export function ConfirmResetPasswordForm({
  email,
  onSuccess,
  onBackToSignIn,
  isRecoverySession = false,
}: ConfirmResetPasswordFormProps) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSetNewPassword = async () => {
    const trimmed = password.trim();
    if (!trimmed) {
      setError('Please enter a new password');
      return;
    }
    if (trimmed.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (trimmed !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: trimmed });

      if (updateError) {
        toast.error(updateError.message ?? 'Failed to update password.');
        setError(updateError.message ?? 'Failed to update password.');
        setIsLoading(false);
        return;
      }

      toast.success('Password updated successfully.');
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to update password. Please try again.');
      setError(err?.message ?? 'Failed to update password.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isRecoverySession) {
    return (
      <FormCard>
        <Text className="text-3xl font-instrument-semibold mb-2 text-center text-white">
          Set New Password
        </Text>
        <Text className="text-center text-gray-300 mb-8 font-instrument">
          Enter your new password below.
        </Text>

        <View className="mb-4">
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">New Password</Text>
          <TextInput
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setError('');
            }}
            placeholder="Enter new password"
            secureTextEntry
            className="border border-white/30 rounded-xl px-4 py-4 bg-white/5 backdrop-blur-sm text-base text-white placeholder-gray-300 focus:border-brand-orange focus:ring-0 focus:bg-white/10"
            style={inputStyle}
            selectionColor="#FF4D00"
            underlineColorAndroid="transparent"
            autoComplete="new-password"
          />
        </View>

        <View className="mb-4">
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Confirm Password</Text>
          <TextInput
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              setError('');
            }}
            placeholder="Confirm new password"
            secureTextEntry
            className="border border-white/30 rounded-xl px-4 py-4 bg-white/5 backdrop-blur-sm text-base text-white placeholder-gray-300 focus:border-brand-orange focus:ring-0 focus:bg-white/10"
            style={inputStyle}
            selectionColor="#FF4D00"
            underlineColorAndroid="transparent"
            autoComplete="new-password"
          />
        </View>

        {error ? (
          <View className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
            <Text className="text-red-400 text-center font-instrument-medium text-sm">
              {error}
            </Text>
          </View>
        ) : null}

        <Button onPress={handleSetNewPassword} className="mb-4" disabled={isLoading}>
          {isLoading ? 'Updating...' : 'Update Password'}
        </Button>

        <Pressable onPress={onBackToSignIn}>
          <Text className="text-center text-gray-300 font-instrument-medium">
            Back to Sign In
          </Text>
        </Pressable>
      </FormCard>
    );
  }

  return (
    <FormCard>
      <Text className="text-3xl font-instrument-semibold mb-2 text-center text-white">
        Check Your Email
      </Text>
      <Text className="text-center text-gray-300 mb-8 font-instrument">
        We sent a password reset link to {email}. Use the link to set a new password, then sign in below.
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
