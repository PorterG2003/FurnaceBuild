import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/FormCard';

export function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { submitForm, toSignUp, toForgotPassword } = useAuthenticator();

  const handleSignIn = async () => {
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await submitForm({ username: email, password });
    } catch (err) {
      setError('Invalid email or password');
      console.error('Sign in error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <FormCard>
      <Text className="text-3xl font-manrope-bold mb-2 text-center text-white">
        Welcome Back
      </Text>
      <Text className="text-center text-gray-300 mb-8 font-manrope">
        Sign in to your account to continue
      </Text>

      {error ? (
        <View className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
          <Text className="text-red-400 text-center font-manrope-medium text-sm">
            {error}
          </Text>
        </View>
      ) : null}

      <View className="mb-4">
        <Text className="text-sm font-manrope-medium mb-2 text-gray-300">Email</Text>
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

      <View className="mb-4">
        <Text className="text-sm font-manrope-medium mb-2 text-gray-300">Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Enter your password"
          secureTextEntry
          className="border border-white/30 rounded-xl px-4 py-4 bg-white/5 backdrop-blur-sm text-base text-white placeholder-gray-300 focus:border-brand-orange focus:ring-0 focus:bg-white/10"
          style={{
            borderColor: '#FFFFFF4D',
            backgroundColor: '#FFFFFF0D',
            color: '#FFFFFF',
            borderWidth: 1,
          }}
          selectionColor="#FF4D00"
          underlineColorAndroid="transparent"
          autoComplete="password"
        />
      </View>

      <Pressable onPress={toForgotPassword} className="mb-6">
        <Text className="text-right text-brand-orange font-manrope-medium">
          Forgot Password?
        </Text>
      </Pressable>

      <Button onPress={handleSignIn} className="mb-4" disabled={isLoading}>
        {isLoading ? 'Signing In...' : 'Sign In'}
      </Button>

      <View className="flex-row justify-center items-center">
          <Text className="text-gray-300 font-manrope">Don't have an account? </Text>
        <Pressable onPress={toSignUp}>
          <Text className="text-brand-orange font-manrope-medium">Sign Up</Text>
        </Pressable>
      </View>
    </FormCard>
  );
}

