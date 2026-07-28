import { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { HELP_EMAIL, HELP_EMAIL_URL } from '@/components/ui/help/HelpModal';
import { AcceptStandaloneCard, BrandedStandalonePageShell } from '@/components/ui/layout';
import { useAccount } from '@/contexts/AccountContext';
import {
  invitationRecoveryFailureMessage,
  isInvitationJoinSuccess,
} from '@/lib/account/invitationRecovery';
import {
  membershipActivationFailureMessage,
  useEnterWorkspace,
} from '@/lib/account/useEnterWorkspace';
import {
  acceptInvitationRpc,
  getMyPendingInvitations,
  type PendingInvitationForCurrentUser,
} from '@/lib/supabase/services/accounts';

export default function NoWorkspacePage() {
  const router = useRouter();
  const { refetch } = useAccount();
  const { enterWorkspace } = useEnterWorkspace();
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<PendingInvitationForCurrentUser[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const loadInvitations = useCallback(async () => {
    setLoadingInvitations(true);
    try {
      setInvitations(await getMyPendingInvitations());
    } catch {
      setInvitations([]);
    } finally {
      setLoadingInvitations(false);
    }
  }, []);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  const handleTryAgain = async () => {
    setRetrying(true);
    setRetryMessage(null);
    try {
      const snapshot = await refetch();
      if (snapshot?.memberships.length) {
        router.replace('/');
        return;
      }
      await loadInvitations();
      setRetryMessage('We still could not find a workspace for this account. Email us if you expected access.');
    } finally {
      setRetrying(false);
    }
  };

  const handleJoin = async (invitation: PendingInvitationForCurrentUser) => {
    setJoiningId(invitation.invitation_id);
    setRetryMessage(null);
    try {
      const result = await acceptInvitationRpc(invitation.invitation_id);

      if (isInvitationJoinSuccess(result.status)) {
        const activation = await enterWorkspace({
          destination: '/',
          expectedAccountId: result.account_id ?? invitation.account_id,
        });
        if (activation.kind !== 'ready') {
          setRetryMessage(
            membershipActivationFailureMessage(
              activation,
              'You joined the workspace, but setup is taking longer than expected. Please refresh or email support.',
            ),
          );
        }
        return;
      }

      setRetryMessage(invitationRecoveryFailureMessage(result.status));
      await loadInvitations();
    } catch (err) {
      setRetryMessage(
        err instanceof Error ? err.message : 'We could not join that workspace. Please try again.',
      );
    } finally {
      setJoiningId(null);
    }
  };

  const busy = retrying || joiningId !== null;
  const hasInvitations = invitations.length > 0;

  return (
    <BrandedStandalonePageShell>
      <AcceptStandaloneCard
        actions={
          <>
            {invitations.map((invitation) => (
              <Button
                key={invitation.invitation_id}
                disabled={busy}
                onPress={() => {
                  void handleJoin(invitation);
                }}
              >
                {joiningId === invitation.invitation_id
                  ? 'Joining…'
                  : `Join ${invitation.account_name}`}
              </Button>
            ))}
            <Button
              variant={hasInvitations ? 'outline' : 'default'}
              disabled={busy}
              onPress={() => {
                void handleTryAgain();
              }}
            >
              {retrying ? 'Checking…' : 'Try again'}
            </Button>
            <Button
              variant="outline"
              onPress={() => {
                void Linking.openURL(HELP_EMAIL_URL);
              }}
            >
              Email {HELP_EMAIL}
            </Button>
          </>
        }
      >
        <Text className="text-white text-2xl font-instrument-bold text-center">
          {hasInvitations ? 'Finish Joining Your Workspace' : 'No Workspace Found'}
        </Text>

        {hasInvitations ? (
          <View className="gap-3">
            <Text className="text-gray-400 text-base font-instrument text-center leading-6">
              You have a pending invitation that was never accepted. Accept it below to get access.
            </Text>
            {invitations.map((invitation) => (
              <Text
                key={invitation.invitation_id}
                className="text-gray-300 text-sm font-instrument text-center leading-5"
              >
                <Text className="font-instrument-bold text-white">{invitation.account_name}</Text>
                {invitation.inviter_name ? ` — invited by ${invitation.inviter_name}` : ''}
              </Text>
            ))}
          </View>
        ) : (
          <Text className="text-gray-400 text-base font-instrument text-center leading-6">
            {loadingInvitations
              ? 'Checking for pending invitations…'
              : `You are signed in, but we could not find a Furnace workspace for this user yet. If you expected access, email ${HELP_EMAIL}.`}
          </Text>
        )}

        {retryMessage ? (
          <Text className="text-gray-500 text-sm font-instrument text-center leading-5">
            {retryMessage}
          </Text>
        ) : null}
      </AcceptStandaloneCard>
    </BrandedStandalonePageShell>
  );
}
