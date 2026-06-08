import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { AppBootScreen } from '@/components/ui/AppBootScreen';
import { Alert } from '@/components/ui/feedback';
import { AcceptStandaloneCard, BrandedStandalonePageShell } from '@/components/ui/layout';
import { useSmoothLoading } from '@/components/ui/feedback/useSmoothLoading';
import {
  getInvitationInfo,
  acceptInvitationRpc,
  type InvitationInfo,
} from '@/lib/supabase/services/accounts';
import { buildPublicAccessRedirectHref } from '@/lib/publicAccessState';

function inviterLabel(info: InvitationInfo | null): string {
  const name = info?.inviter_name?.trim();
  if (name) return name;
  return 'A teammate';
}

export default function AcceptInvitationPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: authUser, loading: authLoading } = useAuth();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const acceptAttemptedRef = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);
  const showBootScreen = useSmoothLoading(bootstrapping, { delayMs: 0 });

  const authEmail = useMemo(
    () => authUser?.email?.toLowerCase().trim() ?? null,
    [authUser],
  );

  const startAccepting = useCallback((invitation: InvitationInfo) => {
    setInfo(invitation);
    setGuestMode(false);
    setAcceptError(null);
    setBootstrapping(false);
    setAccepting(true);
  }, []);

  useEffect(() => {
    if (!id) {
      setLoadError('Invalid invitation link.');
      setBootstrapping(false);
      return;
    }
    if (authLoading) return;

    let cancelled = false;
    setBootstrapping(true);
    setLoadError(null);
    setAcceptError(null);
    setInfo(null);
    setGuestMode(false);
    setAccepting(false);
    acceptAttemptedRef.current = false;

    void (async () => {
      try {
        const result = await getInvitationInfo(id);
        if (cancelled) return;

        setInfo(result);

        switch (result.status) {
          case 'not_found':
          case 'expired':
          case 'accepted':
            router.replace(
              buildPublicAccessRedirectHref({
                isSignedIn: !!authUser,
                state: {
                  flow: 'team_invite',
                  issue:
                    result.status === 'accepted'
                      ? 'resource_completed'
                      : 'resource_unavailable',
                  resourceId: id,
                  inviteeEmail: result.invitee_email ?? null,
                  accountName: result.account_name ?? null,
                },
              }) as any,
            );
            break;
          case 'pending':
            if (!authUser) {
              setGuestMode(true);
              setBootstrapping(false);
              return;
            }

            if (authEmail && result.invitee_email) {
              const inviteeEmail = result.invitee_email.toLowerCase().trim();
              if (authEmail !== inviteeEmail) {
                router.replace(
                  buildPublicAccessRedirectHref({
                    isSignedIn: true,
                    state: {
                      flow: 'team_invite',
                      issue: 'wrong_email',
                      resourceId: id,
                      inviteeEmail: result.invitee_email,
                      accountName: result.account_name ?? null,
                    },
                  }) as any,
                );
                return;
              }
            }

            startAccepting(result);
            return;
          default:
            setLoadError(`Unexpected invitation status: ${result.status}`);
            setBootstrapping(false);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading invitation:', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load invitation.');
        setBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authEmail, authLoading, authUser, id, reloadKey, router, startAccepting]);

  const acceptInvitation = useCallback(async () => {
    if (!id || !info) return;
    setAcceptError(null);
    setAccepting(true);

    try {
      const result = await acceptInvitationRpc(id);

      switch (result.status) {
        case 'accepted':
        case 'already_member':
          router.replace(
            result.account_id ? `/account?switch_account=${result.account_id}` : '/account',
          );
          break;
        case 'email_mismatch':
          router.replace(
            buildPublicAccessRedirectHref({
              isSignedIn: true,
              state: {
                flow: 'team_invite',
                issue: 'wrong_email',
                resourceId: id,
                inviteeEmail: info.invitee_email ?? null,
                accountName: info.account_name ?? null,
              },
            }) as any,
          );
          break;
        case 'expired':
        case 'not_found':
          router.replace(
            buildPublicAccessRedirectHref({
              isSignedIn: !!authUser,
              state: {
                flow: 'team_invite',
                issue: 'resource_unavailable',
                resourceId: id,
                inviteeEmail: info.invitee_email ?? null,
                accountName: info.account_name ?? null,
              },
            }) as any,
          );
          break;
        default:
          setAcceptError(`Unexpected result: ${result.status}`);
          setAccepting(false);
      }
    } catch (err) {
      console.error('Error accepting invitation:', err);
      setAcceptError(err instanceof Error ? err.message : 'Failed to accept invitation.');
      setAccepting(false);
    }
  }, [authUser, id, info, router]);

  useEffect(() => {
    if (!bootstrapping && !guestMode && info && accepting && !acceptAttemptedRef.current) {
      acceptAttemptedRef.current = true;
      void acceptInvitation();
    }
  }, [acceptInvitation, accepting, bootstrapping, guestMode, info]);

  const navigateToAuth = (mode: 'signIn' | 'signUp') => {
    const email = info?.invitee_email ?? '';
    const base = `/auth?invitation_id=${id}`;
    const params =
      mode === 'signUp' && email ? `${base}&email=${encodeURIComponent(email)}&mode=signUp` : base;
    router.replace(params as any);
  };

  const accountName = info?.account_name?.trim() || 'this workspace';

  const renderPendingCard = () => {
    if (!info || info.status !== 'pending') return null;

    return (
      <AcceptStandaloneCard
        actions={
          guestMode ? (
            <>
              <Text className="text-gray-300 text-sm font-instrument text-center">
                Use the same email this invitation was sent to when you continue.
              </Text>
              <Button onPress={() => navigateToAuth('signUp')} variant="default">
                Signup
              </Button>
              <Button onPress={() => navigateToAuth('signIn')} variant="outline">
                Signin
              </Button>
            </>
          ) : (
            <View className="gap-3">
              {acceptError ? <Alert variant="error" message={acceptError} /> : null}
              <View className="items-center py-1">
                <ActivityIndicator size="small" color="#f33203" />
                <Text className="text-gray-400 text-sm font-instrument mt-3 text-center">
                  Joining workspace…
                </Text>
              </View>
              {acceptError ? (
                <Button
                  variant="outline"
                  onPress={() => {
                    acceptAttemptedRef.current = false;
                    setAccepting(true);
                  }}
                >
                  Retry
                </Button>
              ) : null}
            </View>
          )
        }
      >
        <Text className="text-brand-orange text-xs font-instrument-semibold uppercase tracking-wider">
          Team invitation
        </Text>
        <Text className="text-white text-2xl font-instrument-bold">
          Join {accountName}
        </Text>
        <Text className="text-gray-300 text-sm font-instrument leading-5">
          {inviterLabel(info)} invited you to collaborate in Furnace on campaigns, inbox, and leads
          for this account.
        </Text>
        {info.invitee_email ? (
          <View className="rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] px-4 py-3">
            <Text className="text-gray-500 text-xs font-instrument-medium uppercase tracking-wider mb-1">
              Invitation sent to
            </Text>
            <Text className="text-white text-sm font-instrument">{info.invitee_email}</Text>
          </View>
        ) : null}
      </AcceptStandaloneCard>
    );
  };

  if (bootstrapping || showBootScreen) {
    return <AppBootScreen />;
  }

  if (loadError) {
    return (
      <BrandedStandalonePageShell>
        <AcceptStandaloneCard
          actions={
            <>
              <Button
                onPress={() => {
                  acceptAttemptedRef.current = false;
                  setReloadKey((current) => current + 1);
                }}
                variant="outline"
              >
                Retry
              </Button>
              <Button onPress={() => router.replace('/')} variant="default">
                Home
              </Button>
            </>
          }
        >
          <Text className="text-white text-2xl font-instrument-bold text-center">
            Something went wrong
          </Text>
          <Text className="text-red-400 text-base font-instrument text-center leading-5">
            {loadError}
          </Text>
        </AcceptStandaloneCard>
      </BrandedStandalonePageShell>
    );
  }

  return <BrandedStandalonePageShell>{renderPendingCard()}</BrandedStandalonePageShell>;
}
