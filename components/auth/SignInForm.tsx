import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
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

interface SignInFormProps {
  onGoToForgotPassword: () => void;
  initialSuccessMessage?: string;
  showSignUp?: boolean;
  onGoToSignUp?: () => void;
  onRequestAccess?: () => void;
}

export function SignInForm({
  onGoToSignUp,
  onGoToForgotPassword,
  initialSuccessMessage,
  showSignUp = false,
  onRequestAccess,
}: SignInFormProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialSuccessMessage) {
      toast.success(initialSuccessMessage);
    }
  }, [initialSuccessMessage, toast]);

  const handleSignIn = async () => {
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        if (signInError.message.includes('Invalid login')) {
          toast.error('Invalid email or password');
        } else if (signInError.message.includes('Email not confirmed')) {
          toast.error('Please verify your email before signing in');
        } else {
          toast.error(signInError.message);
        }
        setIsLoading(false);
        return;
      }

      toast.success('Sign in successful! Redirecting...');
      setIsLoading(false);
    } catch (err: any) {
      toast.error(err?.message ?? 'Sign in failed. Please try again.');
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
        <Text className={authLabelClassName}>Email</Text>
        <TextInput
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setError('');
          }}
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

      <View className="mb-4">
        <Text className={authLabelClassName}>Password</Text>
        <TextInput
          value={password}
          onChangeText={(text) => {
            setPassword(text);
            setError('');
          }}
          placeholder="Enter your password"
          placeholderTextColor={authPlaceholderColor}
          secureTextEntry
          className={authInputClassName}
          style={authInputStyle}
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

      <Pressable onPress={onGoToForgotPassword} className="mb-6">
        <Text className="text-right text-brand-orange font-instrument-medium">
          Forgot Password?
        </Text>
      </Pressable>

      <Button onPress={handleSignIn} className="mb-4" disabled={isLoading}>
        {isLoading ? 'Signing In...' : 'Sign In'}
      </Button>

      {showSignUp && onGoToSignUp ? (
        <View className="flex-row justify-center items-center">
          <Text className="text-gray-300 font-instrument">Don't have an account? </Text>
          <Pressable onPress={onGoToSignUp}>
            <Text className="text-brand-orange font-instrument-medium">Sign Up</Text>
          </Pressable>
        </View>
      ) : onRequestAccess ? (
        <View className="items-center gap-2">
          <Text className="text-center text-gray-300 font-instrument">
            Furnace is invite only. Look in your email for an invite link.
          </Text>
          <Pressable onPress={onRequestAccess}>
            <Text className="text-brand-orange font-instrument-medium">New to Furnace? Book a call</Text>
          </Pressable>
        </View>
      ) : null}
    </FormCard>
  );
}
