import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { signIn } from 'aws-amplify/auth';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/forms';

interface SignInFormProps {
  onGoToSignUp: () => void;
  onGoToForgotPassword: () => void;
  initialSuccessMessage?: string;
}

export function SignInForm({ onGoToSignUp, onGoToForgotPassword, initialSuccessMessage }: SignInFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(initialSuccessMessage ?? '');

  const handleForgotPassword = () => {
    onGoToForgotPassword();
  };

  const handleSignUp = () => {
    onGoToSignUp();
  };

  const clearInitialSuccessIfUserInteracts = () => {
    if (initialSuccessMessage && success === initialSuccessMessage) {
      setSuccess('');
    }
  };

  const handleSignIn = async () => {
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      const { isSignedIn } = await signIn({
        username: email,
        password: password,
      });

      if (isSignedIn) {
        setSuccess('Sign in successful! Redirecting...');
        setIsLoading(false);
        // The auth guard will handle the redirect
      } else {
        setError('Sign in failed. Please try again.');
        setIsLoading(false);
      }
      
    } catch (err: any) {
      // More specific error handling
      if (err.name === 'UserNotFoundException') {
        setError('No account found with this email');
      } else if (err.name === 'NotAuthorizedException') {
        setError('Incorrect password');
      } else if (err.name === 'UserNotConfirmedException') {
        setError('Please verify your email before signing in');
      } else if (err.name === 'InvalidParameterException') {
        setError('Please check your email format');
      } else {
        setError(`Sign in failed: ${err.message}`);
      }
      setIsLoading(false);
    }
  };

  return (
    <FormCard>
      <Text className="text-3xl font-instrument-semibold mb-2 text-center text-white">
        Welcome Back
      </Text>
      <Text className="text-center text-gray-300 mb-8 font-instrument">
        Sign in to your account to continue
      </Text>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Email</Text>
        <TextInput
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            clearInitialSuccessIfUserInteracts();
          }}
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
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Password</Text>
        <TextInput
          value={password}
          onChangeText={(text) => {
            setPassword(text);
            clearInitialSuccessIfUserInteracts();
          }}
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

      <Pressable onPress={handleForgotPassword} className="mb-6">
        <Text className="text-right text-brand-orange font-instrument-medium">
          Forgot Password?
        </Text>
      </Pressable>

      <Button onPress={handleSignIn} className="mb-4" disabled={isLoading}>
        {isLoading ? 'Signing In...' : 'Sign In'}
      </Button>

      <View className="flex-row justify-center items-center">
          <Text className="text-gray-300 font-instrument">Don't have an account? </Text>
        <Pressable onPress={handleSignUp}>
          <Text className="text-brand-orange font-instrument-medium">Sign Up</Text>
        </Pressable>
      </View>
    </FormCard>
  );
}

