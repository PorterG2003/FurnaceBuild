import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/FormCard';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const { submitForm, toSignIn } = useAuthenticator();

  const handleReset = async () => {
    submitForm({ username: email });
  };

  return (
    <FormCard>
      <Text className="text-3xl font-manrope-bold mb-2 text-center text-gray-900">
        Reset Password
      </Text>
      <Text className="text-center text-gray-700 mb-8 font-manrope">
        Enter your email to receive a password reset code
      </Text>

      <View className="mb-6">
        <Text className="text-sm font-manrope-medium mb-2 text-gray-700">Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Enter your email"
          autoCapitalize="none"
          keyboardType="email-address"
          className="border border-gray-300 rounded-lg px-4 py-3 bg-white text-base"
          autoComplete="email"
        />
      </View>

      <Button onPress={handleReset} className="mb-4">
        Send Reset Code
      </Button>

        <Pressable onPress={toSignIn}>
          <Text className="text-center text-brand-orange font-manrope-medium">
            Back to Sign In
          </Text>
        </Pressable>
    </FormCard>
  );
}

