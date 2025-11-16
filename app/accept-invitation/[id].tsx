import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { Button } from '@/components/ui/button';
import {
  addUserToAccount,
  createUserProfile,
  getInvitationById,
  getUserByEmail,
  getUserByExternalId,
  updateInvitation,
} from '@/lib/supabase/services';
import type { Invitation, User } from '@/lib/supabase/types';

type Status = 'loading' | 'checking' | 'processing' | 'success' | 'error' | 'not-found' | 'expired' | 'already-accepted' | 'email-mismatch' | 'not-authenticated';

export default function AcceptInvitationPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: cognitoUser, authStatus } = useAuthenticator();
  const [status, setStatus] = useState<Status>('loading');
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    if (!id) {
      setStatus('error');
      setErrorMessage('Invalid invitation link');
      return;
    }

    // Wait for auth status to be determined before checking invitation
    if (authStatus === 'configuring') {
      return; // Still loading auth state
    }

    loadInvitation();
  }, [id, authStatus, cognitoUser]);

  const loadInvitation = async () => {
    if (!id) return;

    try {
      setStatus('checking');
      const inv = await getInvitationById(id);

      if (!inv) {
        setStatus('not-found');
        return;
      }

      setInvitation(inv);

      // Check if invitation is expired
      if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
        setStatus('expired');
        return;
      }

      // Check if already accepted
      if (inv.status !== 'pending') {
        setStatus('already-accepted');
        return;
      }

      // If user is authenticated, try to accept
      if (authStatus === 'authenticated' && cognitoUser) {
        await acceptInvitation(inv);
      } else {
        setStatus('not-authenticated');
      }
    } catch (error) {
      console.error('Error loading invitation:', error);
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load invitation');
    }
  };

  const acceptInvitation = async (inv: Invitation) => {
    if (!cognitoUser) {
      setStatus('not-authenticated');
      return;
    }

    try {
      setStatus('processing');

      // Get Cognito user email (matching the logic from account.tsx)
      const loginId = cognitoUser.signInDetails?.loginId ?? null;
      const username = cognitoUser.username ?? null;
      const cognitoEmail =
        (cognitoUser as any)?.attributes?.email ??
        (cognitoUser as any)?.attributes?.preferred_username ??
        loginId ??
        username ??
        null;
      
      if (!cognitoEmail) {
        throw new Error('Unable to get user email from Cognito');
      }

      // Check if email matches invitation
      if (cognitoEmail.toLowerCase().trim() !== inv.email.toLowerCase().trim()) {
        setStatus('email-mismatch');
        setErrorMessage(`This invitation was sent to ${inv.email}, but you're signed in as ${cognitoEmail}. Please sign in with the correct email address.`);
        return;
      }

      // Get or create user profile
      let userProfile: User | null = await getUserByExternalId(cognitoUser.userId);
      
      if (!userProfile) {
        // Create user profile if it doesn't exist
        userProfile = await createUserProfile({
          external_id: cognitoUser.userId,
          email: cognitoEmail,
          name: cognitoUser.signInDetails?.loginId || cognitoEmail.split('@')[0],
        });
      }

      // Check if user is already a member
      const existingUser = await getUserByEmail(inv.email);
      if (existingUser && existingUser.id !== userProfile.id) {
        // This shouldn't happen, but handle it gracefully
        throw new Error('Email already associated with a different user');
      }

      // Add user to account
      await addUserToAccount(inv.account_id, userProfile.id, false);

      // Update invitation status
      await updateInvitation(inv.id, { status: 'accepted' });

      setStatus('success');
      
      // Redirect to account page after a short delay
      setTimeout(() => {
        router.replace('/account');
      }, 2000);
    } catch (error) {
      console.error('Error accepting invitation:', error);
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to accept invitation');
    }
  };

  const handleSignIn = () => {
    router.replace('/auth');
  };

  const renderContent = () => {
    switch (status) {
      case 'loading':
      case 'checking':
      case 'processing':
        return (
          <View className="flex-1 items-center justify-center p-8">
            <ActivityIndicator size="large" color="#f33203" />
            <Text className="text-white text-base font-instrument mt-4">
              {status === 'loading' && 'Loading invitation...'}
              {status === 'checking' && 'Checking invitation...'}
              {status === 'processing' && 'Accepting invitation...'}
            </Text>
          </View>
        );

      case 'not-found':
        return (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-white text-2xl font-instrument-bold mb-4 text-center">
              Invitation Not Found
            </Text>
            <Text className="text-gray-400 text-base font-instrument text-center mb-6">
              This invitation link is invalid or has been removed.
            </Text>
            <Button onPress={() => router.replace('/')} variant="default">
              Go to Home
            </Button>
          </View>
        );

      case 'expired':
        return (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-white text-2xl font-instrument-bold mb-4 text-center">
              Invitation Expired
            </Text>
            <Text className="text-gray-400 text-base font-instrument text-center mb-6">
              This invitation has expired. Please ask for a new invitation.
            </Text>
            <Button onPress={() => router.replace('/')} variant="default">
              Go to Home
            </Button>
          </View>
        );

      case 'already-accepted':
        return (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-white text-2xl font-instrument-bold mb-4 text-center">
              Already Accepted
            </Text>
            <Text className="text-gray-400 text-base font-instrument text-center mb-6">
              This invitation has already been accepted.
            </Text>
            <Button onPress={() => router.replace('/account')} variant="default">
              Go to Account
            </Button>
          </View>
        );

      case 'not-authenticated':
        return (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-white text-2xl font-instrument-bold mb-4 text-center">
              Sign In Required
            </Text>
            <Text className="text-gray-400 text-base font-instrument text-center mb-6">
              {invitation 
                ? `Please sign in with ${invitation.email} to accept this invitation.`
                : 'Please sign in to accept this invitation.'}
            </Text>
            <Button onPress={handleSignIn} variant="default">
              Sign In
            </Button>
          </View>
        );

      case 'email-mismatch':
        return (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-white text-2xl font-instrument-bold mb-4 text-center">
              Email Mismatch
            </Text>
            <Text className="text-gray-400 text-base font-instrument text-center mb-6">
              {errorMessage || 'This invitation was sent to a different email address.'}
            </Text>
            <Button onPress={handleSignIn} variant="default">
              Sign In with Correct Email
            </Button>
          </View>
        );

      case 'success':
        return (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-white text-2xl font-instrument-bold mb-4 text-center">
              Invitation Accepted!
            </Text>
            <Text className="text-gray-400 text-base font-instrument text-center mb-6">
              You've been successfully added to the team. Redirecting...
            </Text>
            <ActivityIndicator size="small" color="#f33203" />
          </View>
        );

      case 'error':
        return (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-white text-2xl font-instrument-bold mb-4 text-center">
              Error
            </Text>
            <Text className="text-red-400 text-base font-instrument text-center mb-6">
              {errorMessage || 'An error occurred while processing the invitation.'}
            </Text>
            <Button onPress={() => router.replace('/')} variant="default">
              Go to Home
            </Button>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View className="flex-1 bg-black">
      <ScrollView className="flex-1" contentContainerClassName="flex-grow">
        {renderContent()}
      </ScrollView>
    </View>
  );
}

