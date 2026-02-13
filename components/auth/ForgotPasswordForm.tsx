import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { resetPassword } from 'aws-amplify/auth';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/forms';

interface ForgotPasswordFormProps {
  onBackToSignIn: () => void;
  onCodeSent: (email: string) => void;
}

export function ForgotPasswordForm({ onBackToSignIn, onCodeSent }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleReset = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Please enter your email');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      await resetPassword({ username: trimmed });

      setSuccess('Check your email for the reset code.');
      onCodeSent(trimmed);
    } catch (err: any) {
      if (err.name === 'UserNotFoundException') {
        setError('No account found with this email');
      } else if (err.name === 'LimitExceededException') {
        setError('Too many attempts. Please try again later.');
      } else if (err.name === 'InvalidParameterException') {
        setError('Please check your email format');
      } else {
        setError(err.message ?? 'Failed to send reset code. Please try again.');
      }
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
        Enter your email to receive a password reset code
      </Text>

      <View className="mb-6">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Enter your email"
          autoCapitalize="none"
          keyboardType="email-address"
          className="border border-white/30 rounded-xl px-4 py-4 bg-white/5 backdrop-blur-sm text-base text-white placeholder-gray-300 focus:border-brand-orange focus:ring-0 focus:bg-white/10"
          style={{
            borderColor: '#FFFFFF4D',
            backgroundColor: '#FFFFFF0D',
            color: '#FFFFFF',
            borderWidth: 1,
          }}
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

      {success ? (
        <View className="mb-4 p-3 bg-green-500/20 border border-green-500/30 rounded-xl">
          <Text className="text-green-400 text-center font-instrument-medium text-sm">
            {success}
          </Text>
        </View>
      ) : null}

      <Button onPress={handleReset} className="mb-4" disabled={isLoading}>
        {isLoading ? 'Sending...' : 'Send Reset Code'}
      </Button>

      <Pressable onPress={onBackToSignIn}>
        <Text className="text-center text-brand-orange font-instrument-medium">
          Back to Sign In
        </Text>
      </Pressable>
    </FormCard>
  );
}
