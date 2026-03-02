import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

interface InvitationInfo {
  status: string;
  account_name?: string;
  inviter_name?: string;
  invitee_email?: string;
  expires_at?: string;
}

interface AcceptResult {
  status: string;
  account_id?: string;
}

type PageStatus =
  | 'loading'
  | 'pending'
  | 'accepting'
  | 'success'
  | 'not-found'
  | 'expired'
  | 'already-accepted'
  | 'email-mismatch'
  | 'error';

export default function AcceptInvitationPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: authUser, loading: authLoading, signOut } = useAuth();
  const [status, setStatus] = useState<PageStatus>('loading');
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const acceptAttemptedRef = useRef(false);

  const authEmail = useMemo(
    () => authUser?.email?.toLowerCase().trim() ?? null,
    [authUser],
  );

  // Phase 1: fetch invitation info (no auth needed)
  useEffect(() => {
    if (!id) {
      setStatus('error');
      setErrorMessage('Invalid invitation link.');
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_invitation_info', {
          p_invitation_id: id,
        });

        if (error) throw new Error(error.message);

        const result = data as InvitationInfo;
        setInfo(result);

        switch (result.status) {
          case 'not_found':
            setStatus('not-found');
            break;
          case 'expired':
            setStatus('expired');
            break;
          case 'accepted':
            setStatus('already-accepted');
            break;
          case 'pending':
            setStatus('pending');
            break;
          default:
            setStatus('error');
            setErrorMessage(`Unexpected invitation status: ${result.status}`);
        }
      } catch (err) {
        console.error('Error loading invitation:', err);
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load invitation.');
      }
    })();
  }, [id]);

  // Phase 2: auto-accept when authenticated + invitation is pending
  useEffect(() => {
    if (status !== 'pending' || authLoading || !authUser || !info || acceptAttemptedRef.current) return;

    const inviteeEmail = info.invitee_email?.toLowerCase().trim();
    if (!inviteeEmail || !authEmail) return;

    if (authEmail !== inviteeEmail) {
      setStatus('email-mismatch');
      return;
    }

    acceptAttemptedRef.current = true;
    acceptInvitation();
  }, [status, authLoading, authUser, info, authEmail]);

  const acceptInvitation = async () => {
    if (!id) return;
    setStatus('accepting');

    try {
      const { data, error } = await supabase.rpc('accept_invitation', {
        p_invitation_id: id,
      });

      if (error) throw new Error(error.message);

      const result = data as AcceptResult;

      switch (result.status) {
        case 'accepted':
          setStatus('success');
          setTimeout(() => {
            const params = result.account_id ? `?switch_account=${result.account_id}` : '';
            router.replace(`/account${params}` as any);
          }, 1500);
          break;
        case 'already_member':
          setStatus('success');
          setTimeout(() => {
            const params = result.account_id ? `?switch_account=${result.account_id}` : '';
            router.replace(`/account${params}` as any);
          }, 1500);
          break;
        case 'email_mismatch':
          setStatus('email-mismatch');
          break;
        case 'expired':
          setStatus('expired');
          break;
        case 'not_found':
          setStatus('not-found');
          break;
        default:
          setStatus('error');
          setErrorMessage(`Unexpected result: ${result.status}`);
      }
    } catch (err) {
      console.error('Error accepting invitation:', err);
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to accept invitation.');
    }
  };

  const navigateToAuth = (mode: 'signIn' | 'signUp') => {
    const email = info?.invitee_email ?? '';
    const base = `/auth?invitation_id=${id}`;
    const params = mode === 'signUp' && email ? `${base}&email=${encodeURIComponent(email)}&mode=signUp` : `${base}`;
    router.replace(params as any);
  };

  const handleSignOutAndRetry = async () => {
    await signOut();
    setStatus('pending');
    acceptAttemptedRef.current = false;
  };

  const renderInvitationCard = () => {
    if (!info || info.status !== 'pending') return null;

    return (
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 mb-6 w-full max-w-sm">
        <Text className="text-gray-400 text-xs font-instrument-medium uppercase tracking-wider mb-3">
          You've been invited to join
        </Text>
        <Text className="text-white text-2xl font-instrument-bold mb-2">
          {info.account_name ?? 'a team'}
        </Text>
        <Text className="text-gray-400 text-sm font-instrument">
          Invited by {info.inviter_name ?? 'a team member'}
        </Text>
        {info.invitee_email && (
          <View className="mt-3 pt-3 border-t border-[#2A2A2A]">
            <Text className="text-gray-500 text-xs font-instrument">
              Sent to {info.invitee_email}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderContent = () => {
    switch (status) {
      case 'loading':
      case 'accepting':
        return (
          <View className="flex-1 items-center justify-center p-8">
            <ActivityIndicator size="large" color="#f33203" />
            <Text className="text-white text-base font-instrument mt-4">
              {status === 'loading' ? 'Loading invitation...' : 'Joining team...'}
            </Text>
          </View>
        );

      case 'pending':
        return (
          <View className="flex-1 items-center justify-center p-8">
            {renderInvitationCard()}

            {authLoading ? (
              <ActivityIndicator size="small" color="#f33203" />
            ) : !authUser ? (
              <View className="w-full max-w-sm gap-4">
                <Text className="text-gray-300 text-sm font-instrument text-center">
                  Create an account to get started, or sign in if you already have one.
                </Text>
                <Button onPress={() => navigateToAuth('signUp')} variant="default">
                  Create Account
                </Button>
                <Button onPress={() => navigateToAuth('signIn')} variant="outline">
                  I Already Have an Account
                </Button>
              </View>
            ) : null}
          </View>
        );

      case 'not-found':
        return (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-white text-2xl font-instrument-bold mb-4 text-center">
              Invitation Not Found
            </Text>
            <Text className="text-gray-400 text-base font-instrument text-center mb-6">
              This invitation link is invalid or has been revoked.
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
              This invitation has expired. Ask your team for a new one.
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

      case 'email-mismatch':
        return (
          <View className="flex-1 items-center justify-center p-8">
            {renderInvitationCard()}
            <View className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 w-full max-w-sm">
              <Text className="text-red-400 text-sm font-instrument text-center">
                This invitation was sent to {info?.invitee_email ?? 'a different email'}, but you're signed in as {authEmail ?? 'a different account'}.
              </Text>
            </View>
            <View className="w-full max-w-sm gap-3">
              <Button onPress={handleSignOutAndRetry} variant="default">
                Sign Out and Use Correct Email
              </Button>
              <Button onPress={() => router.replace('/account')} variant="outline">
                Go to Account
              </Button>
            </View>
          </View>
        );

      case 'success':
        return (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-white text-2xl font-instrument-bold mb-4 text-center">
              You're In!
            </Text>
            <Text className="text-gray-400 text-base font-instrument text-center mb-6">
              You've joined {info?.account_name ?? 'the team'}. Redirecting...
            </Text>
            <ActivityIndicator size="small" color="#f33203" />
          </View>
        );

      case 'error':
        return (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-white text-2xl font-instrument-bold mb-4 text-center">
              Something Went Wrong
            </Text>
            <Text className="text-red-400 text-base font-instrument text-center mb-6">
              {errorMessage || 'An error occurred while processing the invitation.'}
            </Text>
            <View className="flex-row gap-3">
              <Button onPress={() => { acceptAttemptedRef.current = false; setStatus('loading'); window.location.reload(); }} variant="outline">
                Try Again
              </Button>
              <Button onPress={() => router.replace('/')} variant="default">
                Go to Home
              </Button>
            </View>
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
