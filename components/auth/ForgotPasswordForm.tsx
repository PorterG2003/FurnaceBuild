import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/forms';

interface ForgotPasswordFormProps {
  onBackToSignIn: () => void;
}

export function ForgotPasswordForm({ onBackToSignIn }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const { submitForm, toSignIn } = useAuthenticator();

  const handleReset = async () => {
    submitForm({ username: email });
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

      <Button onPress={handleReset} className="mb-4">
        Send Reset Code
      </Button>

                <Pressable onPress={onBackToSignIn}>
                  <Text className="text-center text-brand-orange font-instrument-medium">
                    Back to Sign In
                  </Text>
                </Pressable>
    </FormCard>
  );
}

