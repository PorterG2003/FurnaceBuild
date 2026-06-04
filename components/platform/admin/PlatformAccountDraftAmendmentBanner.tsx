import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import type { PlatformAccountAmendment } from '@/lib/supabase/services/platform';

type PlatformAccountDraftAmendmentBannerProps = {
  accountId: string;
  draftAmendment: PlatformAccountAmendment;
  savingAction?: boolean;
  onCancel: () => void;
};

export function PlatformAccountDraftAmendmentBanner({
  accountId,
  draftAmendment,
  savingAction,
  onCancel,
}: PlatformAccountDraftAmendmentBannerProps) {
  const router = useRouter();

  return (
    <View className="rounded-xl border border-[#3A3A3A] bg-[#1A1A1A] p-4 flex-row flex-wrap items-center justify-between gap-3">
      <View className="flex-1 min-w-[200px]">
        <Text className="text-white font-instrument-semibold">Draft amendment</Text>
        <Text className="text-gray-400 font-instrument text-sm mt-1">
          v{draftAmendment.current_revision_number} — not published to the owner yet.
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onPress={() =>
            router.push({
              pathname: '/admin/accounts/sign-account-amendment',
              params: { accountId, amendmentId: draftAmendment.id },
            })
          }
        >
          Resume editing
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={savingAction}
          onPress={onCancel}
        >
          Cancel draft
        </Button>
      </View>
    </View>
  );
}
