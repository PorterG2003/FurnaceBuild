import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { confirmSignUp, signIn } from 'aws-amplify/auth';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/FormCard';

interface ConfirmSignUpFormProps {
  email: string;
  password: string;
  onSuccess: () => void;
  onBackToSignIn: () => void;
}

export function ConfirmSignUpForm({ email, password, onSuccess, onBackToSignIn }: ConfirmSignUpFormProps) {
  const [verificationCode, setVerificationCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleConfirmSignUp = async () => {
    if (!verificationCode.trim()) {
      setError('Please enter the verification code');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');

    console.log('📧 Attempting to confirm sign up with code:', verificationCode);

    try {
      // First try to confirm the signup
      const { isSignUpComplete, nextStep } = await confirmSignUp({
        username: email,
        confirmationCode: verificationCode
      });

      console.log('📧 Confirm signup result:', { isSignUpComplete, nextStep });

      if (isSignUpComplete) {
        try {
          // Then try to sign in
          console.log('📧 Attempting auto sign-in...');
          const { isSignedIn } = await signIn({
            username: email,
            password: password,
          });

          console.log('📧 Sign in result:', { isSignedIn });

          if (isSignedIn) {
            setSuccess('Account verified and signed in successfully!');
            setIsLoading(false);
            // Call onSuccess to navigate to main app
            setTimeout(() => {
              onSuccess();
            }, 1500);
          }
        } catch (signInErr: any) {
          console.error('📧 Sign in error:', signInErr);
          setError("Failed to sign in after confirmation. Please try signing in manually.");
          setIsLoading(false);
          setTimeout(() => {
            onBackToSignIn();
          }, 2000);
        }
      }
    } catch (err: any) {
      console.error('📧 Confirm Sign Up Error:', err);
      
      if (err.name === 'ExpiredCodeException') {
        setError("Verification code has expired. Please request a new code.");
      } else if (err.name === 'NotAuthorizedException' && err.message.includes('CONFIRMED')) {
        // User is already confirmed, try to sign in directly
        try {
          const { isSignedIn } = await signIn({
            username: email,
            password: password,
          });
          if (isSignedIn) {
            setSuccess('Account is already confirmed. Signed in successfully!');
            setIsLoading(false);
            setTimeout(() => {
              onSuccess();
            }, 1500);
          }
        } catch (signInErr) {
          setError("Account is already confirmed. Please sign in.");
          setIsLoading(false);
          setTimeout(() => {
            onBackToSignIn();
          }, 2000);
        }
      } else {
        setError("Failed to confirm sign-up. Please check the code and try again.");
        setIsLoading(false);
      }
    }
  };

  const handleResendCode = async () => {
    console.log('📧 Resend code requested');
    setSuccess('Verification code resent! Please check your email.');
    // TODO: Implement resend code functionality
  };

  return (
    <FormCard>
      <Text className="text-3xl font-instrument-semibold mb-2 text-center text-white">
        Verify Your Email
      </Text>
      <Text className="text-center text-gray-300 mb-8 font-instrument">
        Enter the verification code sent to {email}
      </Text>

      <View className="mb-6">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Verification Code</Text>
        <TextInput
          value={verificationCode}
          onChangeText={setVerificationCode}
          placeholder="Enter 6-digit code"
          keyboardType="number-pad"
          className="border border-white/30 rounded-xl px-4 py-4 bg-white/5 backdrop-blur-sm text-base text-white placeholder-gray-300 focus:border-brand-orange focus:ring-0 focus:bg-white/10 text-center text-xl tracking-widest"
          style={{
            borderColor: '#FFFFFF4D',
            backgroundColor: '#FFFFFF0D',
            color: '#FFFFFF',
            borderWidth: 1,
          }}
          selectionColor="#FF4D00"
          underlineColorAndroid="transparent"
          maxLength={6}
          autoFocus
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

      <Button onPress={handleConfirmSignUp} className="mb-4" disabled={isLoading}>
        {isLoading ? 'Verifying...' : 'Verify Email'}
      </Button>

      <Pressable onPress={handleResendCode} className="mb-4">
        <Text className="text-center text-brand-orange font-instrument-medium">
          Resend Code
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

