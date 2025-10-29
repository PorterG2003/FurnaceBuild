import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { signUp } from 'aws-amplify/auth';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/ui/FormCard';

interface SignUpFormProps {
  onSignUpSuccess: (email: string, password: string) => void;
  onBackToSignIn: () => void;
}

export function SignUpForm({ onSignUpSuccess, onBackToSignIn }: SignUpFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showUserExistsOptions, setShowUserExistsOptions] = useState(false);

  // Log current state
  console.log('📝 SignUpForm - Current state:', { email, isLoading, error, success });

  // Navigation functions (we'll need to pass these as props or use router)
  const handleSignIn = () => {
    onBackToSignIn();
  };

  const validatePassword = (password: string) => {
    const errors = [];
    if (password.length < 8) errors.push('at least 8 characters');
    if (!/[a-z]/.test(password)) errors.push('lowercase letters');
    if (!/[A-Z]/.test(password)) errors.push('uppercase letters');
    if (!/[0-9]/.test(password)) errors.push('numbers');
    if (!/[^a-zA-Z0-9]/.test(password)) errors.push('symbols');
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
    setSuccess('');

    console.log('📝 Attempting sign up with email:', email);

    try {
      console.log('📝 Calling AWS Amplify signUp API...');
      const result = await signUp({
        username: email,
        password: password,
        options: {
          userAttributes: {
            email: email
          }
        }
      });

      console.log('📝 SignUp result:', result);
      console.log('📝 Next step:', result.nextStep);

      if (result.nextStep) {
        switch (result.nextStep.signUpStep) {
          case 'CONFIRM_SIGN_UP':
            console.log('📝 Email confirmation required');
            setSuccess('Account created! Please check your email for verification code.');
            setIsLoading(false);
            // Call the success callback to navigate to verification
            setTimeout(() => {
              onSignUpSuccess(email, password);
            }, 1500);
            break;
          case 'DONE':
            console.log('📝 Sign up complete');
            setSuccess('Account created successfully! Redirecting...');
            setIsLoading(false);
            break;
          case 'COMPLETE_AUTO_SIGN_IN':
            console.log('📝 Auto sign-in required');
            setSuccess('Account created! Completing sign-in...');
            setIsLoading(false);
            break;
          default:
            console.log('📝 Unknown next step:', result.nextStep);
            setSuccess('Account created! Please check your email for verification code.');
            setIsLoading(false);
            // Call the success callback to navigate to verification
            setTimeout(() => {
              onSignUpSuccess(email, password);
            }, 1500);
        }
      } else {
        console.log('📝 No nextStep in response');
        setSuccess('Account created! Please check your email for verification code.');
        setIsLoading(false);
      }
      
    } catch (err: any) {
      console.error('📝 Sign up error:', err);
      console.error('📝 Error details:', JSON.stringify(err, null, 2));
      
      // More specific error handling
      if (err.name === 'UsernameExistsException') {
        setError('An account with this email already exists.');
        setShowUserExistsOptions(true);
        setIsLoading(false);
      } else if (err.name === 'InvalidPasswordException') {
        setError('Password does not meet requirements');
      } else if (err.name === 'InvalidParameterException') {
        setError('Please check your email format');
      } else {
        setError(`Sign up failed: ${err.message}`);
      }
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

      {success ? (
        <View className="mb-4 p-3 bg-green-500/20 border border-green-500/30 rounded-xl">
          <Text className="text-green-400 text-center font-instrument-medium text-sm">
            {success}
          </Text>
        </View>
      ) : null}

      <Button onPress={handleSignUp} className="mb-4" disabled={isLoading}>
        {isLoading ? 'Creating Account...' : 'Sign Up'}
      </Button>

        <View className="flex-row justify-center items-center">
          <Text className="text-gray-300 font-instrument">Already have an account? </Text>
          <Pressable onPress={handleSignIn}>
            <Text className="text-brand-orange font-instrument-medium">Sign In</Text>
          </Pressable>
        </View>
    </FormCard>
  );
}

