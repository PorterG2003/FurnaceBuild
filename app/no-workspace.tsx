import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { HELP_EMAIL, HELP_EMAIL_URL } from '@/components/ui/help/HelpModal';
import { AcceptStandaloneCard, BrandedStandalonePageShell } from '@/components/ui/layout';
import { useAccount } from '@/contexts/AccountContext';

export default function NoWorkspacePage() {
  const router = useRouter();
  const { refetch } = useAccount();
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  const handleTryAgain = async () => {
    setRetrying(true);
    setRetryMessage(null);
    try {
      const snapshot = await refetch();
      if (snapshot?.memberships.length) {
        router.replace('/');
        return;
      }
      setRetryMessage('We still could not find a workspace for this account. Email us if you expected access.');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <BrandedStandalonePageShell>
      <AcceptStandaloneCard
        actions={
          <>
            <Button disabled={retrying} onPress={() => { void handleTryAgain(); }}>
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
          No Workspace Found
        </Text>
        <Text className="text-gray-400 text-base font-instrument text-center leading-6">
          You are signed in, but we could not find a Furnace workspace for this user yet. If you
          expected access, email {HELP_EMAIL}.
        </Text>
        {retryMessage ? (
          <Text className="text-gray-500 text-sm font-instrument text-center leading-5">
            {retryMessage}
          </Text>
        ) : null}
      </AcceptStandaloneCard>
    </BrandedStandalonePageShell>
  );
}
