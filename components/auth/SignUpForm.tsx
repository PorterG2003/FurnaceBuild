import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/forms';
import { useToast } from '@/components/ui/feedback';

interface SignUpFormProps {
  onSignUpSuccess: (email: string, password: string) => void;
  onBackToSignIn: () => void;
  initialEmail?: string;
}

export function SignUpForm({ onSignUpSuccess, onBackToSignIn, initialEmail }: SignUpFormProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState(initialEmail ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showUserExistsOptions, setShowUserExistsOptions] = useState(false);

  const validatePassword = (pwd: string) => {
    const errors: string[] = [];
    if (pwd.length < 8) errors.push('at least 8 characters');
    if (!/[a-z]/.test(pwd)) errors.push('lowercase letters');
    if (!/[A-Z]/.test(pwd)) errors.push('uppercase letters');
    if (!/[0-9]/.test(pwd)) errors.push('numbers');
    if (!/[^a-zA-Z0-9]/.test(pwd)) errors.push('symbols');
    return errors;
  };

  const handleSignUp = async () => {
    if (!email || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      setError(`Password must contain ${passwordErrors.join(', ')}`);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered') || signUpError.message.includes('already exists')) {
          setError('An account with this email already exists.');
          setShowUserExistsOptions(true);
        } else {
          toast.error(signUpError.message);
        }
        setIsLoading(false);
        return;
      }

      if (data?.user && !data.user.identities?.length) {
        setError('An account with this email already exists.');
        setShowUserExistsOptions(true);
        setIsLoading(false);
        return;
      }

      if (data?.session) {
        toast.success('Account created successfully! Redirecting...');
        setIsLoading(false);
        onSignUpSuccess(email.trim(), password);
        return;
      }

      toast.success('Account created! Please check your email to confirm your account.');
      setError('');
      setIsLoading(false);
      onSignUpSuccess(email.trim(), password);
    } catch (err: any) {
      toast.error(err?.message ?? 'Sign up failed. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <FormCard>
      <Text className="text-3xl font-instrument-semibold mb-2 text-center text-white">
        Create Account
      </Text>
      <Text className="text-center text-gray-300 mb-8 font-instrument">
        Sign up to get started
      </Text>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Email</Text>
        <TextInput
          value={email}
          onChangeText={initialEmail ? undefined : setEmail}
          editable={!initialEmail}
          placeholder="Enter your email"
          autoCapitalize="none"
          keyboardType="email-address"
          className="border border-white/30 rounded-xl px-4 py-4 bg-white/5 backdrop-blur-sm text-base text-white placeholder-gray-300 focus:border-brand-orange focus:ring-0 focus:bg-white/10"
          style={{
            borderColor: initialEmail ? '#FFFFFF1A' : '#FFFFFF4D',
            backgroundColor: initialEmail ? '#FFFFFF08' : '#FFFFFF0D',
            color: initialEmail ? '#9CA3AF' : '#FFFFFF',
            borderWidth: 1,
          }}
          selectionColor="#FF4D00"
          underlineColorAndroid="transparent"
          autoComplete="email"
        />
        {initialEmail && (
          <Text className="text-xs text-gray-500 mt-1 font-instrument">
            Email is set by the invitation and cannot be changed.
          </Text>
        )}
      </View>

      <View className="mb-4">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Password</Text>
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
          autoComplete="password-new"
        />
      </View>

      <View className="mb-6">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Confirm Password</Text>
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Confirm your password"
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
          autoComplete="password-new"
        />
      </View>

      {error ? (
        <View className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
          <Text className="text-red-400 text-center font-instrument-medium text-sm">
            {error}
          </Text>
          {showUserExistsOptions && (
            <View className="mt-3 flex-row justify-center gap-3">
              <Pressable
                onPress={() => onSignUpSuccess(email, password)}
                className="px-4 py-2 bg-brand-orange/20 border border-brand-orange/30 rounded-lg"
              >
                <Text className="text-brand-orange font-instrument-medium text-sm">
                  Verify Account
                </Text>
              </Pressable>
              <Pressable
                onPress={onBackToSignIn}
                className="px-4 py-2 bg-gray-500/20 border border-gray-500/30 rounded-lg"
              >
                <Text className="text-gray-300 font-instrument-medium text-sm">
                  Sign In Instead
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      <Button onPress={handleSignUp} className="mb-4" disabled={isLoading}>
        {isLoading ? 'Creating Account...' : 'Sign Up'}
      </Button>

      <View className="flex-row justify-center items-center">
        <Text className="text-gray-300 font-instrument">Already have an account? </Text>
        <Pressable onPress={onBackToSignIn}>
          <Text className="text-brand-orange font-instrument-medium">Sign In</Text>
        </Pressable>
      </View>
    </FormCard>
  );
}
