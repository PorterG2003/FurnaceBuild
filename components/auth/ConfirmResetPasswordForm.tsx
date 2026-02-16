import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { confirmResetPassword, resetPassword } from 'aws-amplify/auth';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/forms';
import { useToast } from '@/components/ui/feedback';

interface ConfirmResetPasswordFormProps {
  email: string;
  onSuccess: () => void;
  onBackToSignIn: () => void;
}

const inputStyle = {
  borderColor: '#FFFFFF4D',
  backgroundColor: '#FFFFFF0D',
  color: '#FFFFFF',
  borderWidth: 1,
};

export function ConfirmResetPasswordForm({ email, onSuccess, onBackToSignIn }: ConfirmResetPasswordFormProps) {
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState('');

  const handleResetPassword = async () => {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError('Please enter the reset code');
      return;
    }
    if (!newPassword) {
      setError('Please enter your new password');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await confirmResetPassword({
        username: email,
        confirmationCode: trimmedCode,
        newPassword,
      });

      toast.success('Password updated. Sign in with your new password.');
      setIsLoading(false);
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err: any) {
      if (err.name === 'ExpiredCodeException') {
        toast.error('Code expired. Request a new code.');
      } else if (err.name === 'CodeMismatchException') {
        toast.error('Invalid code. Please check and try again.');
      } else {
        toast.error(err.message ?? 'Failed to reset password. Please try again.');
      }
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsResending(true);
    setError('');

    try {
      await resetPassword({ username: email });
      toast.success('Reset code resent! Check your email.');
    } catch (err: any) {
      if (err.name === 'LimitExceededException') {
        toast.error('Too many attempts. Please try again later.');
      } else {
        toast.error(err.message ?? 'Failed to resend code.');
      }
    } finally {
      setIsResending(false);
    }
  };

  return (
    <FormCard>
      <Text className="text-3xl font-instrument-semibold mb-2 text-center text-white">
        Set New Password
      </Text>
      <Text className="text-center text-gray-300 mb-8 font-instrument">
        Enter the code sent to {email} and your new password
      </Text>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Reset Code</Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="Enter 6-digit code"
          keyboardType="number-pad"
          className="border border-white/30 rounded-xl px-4 py-4 bg-white/5 backdrop-blur-sm text-base text-white placeholder-gray-300 focus:border-brand-orange focus:ring-0 focus:bg-white/10 text-center text-xl tracking-widest"
          style={inputStyle}
          selectionColor="#FF4D00"
          underlineColorAndroid="transparent"
          maxLength={6}
          autoFocus
        />
      </View>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">New Password</Text>
        <TextInput
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="Enter new password"
          secureTextEntry
          className="border border-white/30 rounded-xl px-4 py-4 bg-white/5 backdrop-blur-sm text-base text-white placeholder-gray-300 focus:border-brand-orange focus:ring-0 focus:bg-white/10"
          style={inputStyle}
          selectionColor="#FF4D00"
          underlineColorAndroid="transparent"
          autoComplete="new-password"
        />
      </View>

      <View className="mb-6">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Confirm Password</Text>
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
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

      <Button onPress={handleResetPassword} className="mb-4" disabled={isLoading}>
        {isLoading ? 'Resetting...' : 'Reset Password'}
      </Button>

      <Pressable onPress={handleResendCode} className="mb-4" disabled={isResending}>
        <Text className="text-center text-brand-orange font-instrument-medium">
          {isResending ? 'Sending...' : 'Resend Code'}
        </Text>
      </Pressable>

      <Pressable onPress={onBackToSignIn}>
        <Text className="text-center text-gray-300 font-instrument-medium">
          Back to Sign In
        </Text>
      </Pressable>
    </FormCard>
  );
}
