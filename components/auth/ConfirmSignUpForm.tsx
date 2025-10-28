import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/FormCard';

export function ConfirmSignUpForm() {
  const [confirmationCode, setConfirmationCode] = useState('');
  const { submitForm, resendCode } = useAuthenticator();

  const handleConfirm = async () => {
    submitForm({ confirmationCode });
  };

  return (
    <FormCard>
      <Text className="text-3xl font-manrope-bold mb-2 text-center text-gray-900">
        Confirm Your Email
      </Text>
      <Text className="text-center text-gray-700 mb-8 font-manrope">
        Enter the confirmation code sent to your email
      </Text>

        <View className="mb-6">
          <Text className="text-sm font-manrope-medium mb-2 text-gray-700">Confirmation Code</Text>
          <TextInput
            value={confirmationCode}
            onChangeText={setConfirmationCode}
            placeholder="Enter 6-digit code"
            keyboardType="number-pad"
            className="border border-gray-300 rounded-lg px-4 py-3 bg-white text-base text-center text-xl tracking-widest"
            maxLength={6}
            autoFocus
          />
        </View>

        <Button onPress={handleConfirm} className="mb-4">
          Confirm Sign Up
        </Button>

        <Pressable onPress={resendCode}>
          <Text className="text-center text-brand-orange font-manrope-medium">
            Resend Code
          </Text>
        </Pressable>
    </FormCard>
  );
}

