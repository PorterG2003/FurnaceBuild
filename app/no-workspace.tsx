import { Linking, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { HELP_EMAIL, HELP_EMAIL_URL } from '@/components/ui/help/HelpModal';
import { AcceptStandaloneCard, BrandedStandalonePageShell } from '@/components/ui/layout';

export default function NoWorkspacePage() {
  const router = useRouter();

  return (
    <BrandedStandalonePageShell>
      <AcceptStandaloneCard
        actions={
          <>
            <Button onPress={() => router.replace('/')}>Try again</Button>
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
      </AcceptStandaloneCard>
    </BrandedStandalonePageShell>
  );
}
