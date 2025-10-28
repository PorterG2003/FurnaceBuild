import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/FormCard';

export function SignUpForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { submitForm, toSignIn } = useAuthenticator();

  const handleSignUp = async () => {
    if (password !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }
    submitForm({ username: email, password });
  };

  return (
    <FormCard>
      <Text className="text-3xl font-manrope-bold mb-2 text-center text-gray-900">
        Create Account
      </Text>
      <Text className="text-center text-gray-700 mb-8 font-manrope">
        Sign up to get started
      </Text>

      <View className="mb-4">
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

      <View className="mb-4">
        <Text className="text-sm font-manrope-medium mb-2 text-gray-700">Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Enter your password"
          secureTextEntry
          className="border border-gray-300 rounded-lg px-4 py-3 bg-white text-base"
          autoComplete="password-new"
        />
      </View>

      <View className="mb-6">
        <Text className="text-sm font-manrope-medium mb-2 text-gray-700">Confirm Password</Text>
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Confirm your password"
          secureTextEntry
          className="border border-gray-300 rounded-lg px-4 py-3 bg-white text-base"
          autoComplete="password-new"
        />
      </View>

      <Button onPress={handleSignUp} className="mb-4">
        Sign Up
      </Button>

        <View className="flex-row justify-center items-center">
          <Text className="text-gray-600 font-manrope">Already have an account? </Text>
          <Pressable onPress={toSignIn}>
            <Text className="text-brand-orange font-manrope-medium">Sign In</Text>
          </Pressable>
        </View>
    </FormCard>
  );
}

