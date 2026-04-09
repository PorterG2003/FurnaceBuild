import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/forms';
import { useToast } from '@/components/ui/feedback';
import {
  authInputClassName,
  authInputStyle,
  authLabelClassName,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';

/** Base URL for password reset redirect. Set EXPO_PUBLIC_APP_URL in .env to match Supabase Redirect URLs (e.g. http://localhost:8081 or production URL). */
function getAppBaseUrl(): string | undefined {
  if (Platform.OS !== 'web') return undefined;
  const fromEnv = process.env.EXPO_PUBLIC_APP_URL ?? Constants.expoConfig?.extra?.appUrl;
  if (typeof fromEnv === 'string' && fromEnv) return fromEnv;
  if (typeof window !== 'undefined') return window.location.origin;
  return undefined;
}

interface ForgotPasswordFormProps {
  onBackToSignIn: () => void;
  onCodeSent: (email: string) => void;
}

export function ForgotPasswordForm({ onBackToSignIn, onCodeSent }: ForgotPasswordFormProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleReset = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Please enter your email');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const baseUrl = getAppBaseUrl();
      const redirectTo = baseUrl ? `${baseUrl.replace(/\/$/, '')}/auth` : undefined;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo,
      });

      if (resetError) {
        toast.error(resetError.message ?? 'Failed to send reset email.');
        setIsLoading(false);
        return;
      }

      toast.success('Check your email for the password reset link.');
      onCodeSent(trimmed);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to send reset email. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <FormCard>
      <Text className="text-3xl font-instrument-semibold mb-2 text-center text-white">
        Reset Password
      </Text>
      <Text className="text-center text-gray-300 mb-8 font-instrument">
        Enter your email to receive a password reset link
      </Text>

      <View className="mb-6">
        <Text className={authLabelClassName}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
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

      {error ? (
        <View className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
          <Text className="text-red-400 text-center font-instrument-medium text-sm">
            {error}
          </Text>
        </View>
      ) : null}

      <Button onPress={handleReset} className="mb-4" disabled={isLoading}>
        {isLoading ? 'Sending...' : 'Send Reset Link'}
      </Button>

      <Pressable onPress={onBackToSignIn}>
        <Text className="text-center text-brand-orange font-instrument-medium">
          Back to Sign In
        </Text>
      </Pressable>
    </FormCard>
  );
}
