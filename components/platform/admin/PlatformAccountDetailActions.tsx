import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import type { PlatformAccountAmendment } from '@/lib/supabase/services/platform';

export type PlatformAccountDetailActionsProps = {
  accountId: string;
  pendingAmendment: PlatformAccountAmendment | null;
  ownerEmail: string | null;
  accountName: string | null;
  inviterName: string;
  savingAction?: boolean;
  onResendEmail?: () => void;
};

export function PlatformAccountDetailDesktopActions({
  accountId,
  pendingAmendment,
  savingAction,
  onResendEmail,
}: PlatformAccountDetailActionsProps) {
  const router = useRouter();
  const hubDisabled = pendingAmendment != null;

  return (
    <View className="flex-row flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={hubDisabled}
        accessibilityLabel={
          hubDisabled
            ? 'Manage contract and billing (disabled while amendment awaits owner acceptance)'
            : 'Manage contract and billing'
        }
        onPress={() =>
          router.push({
            pathname: '/admin/accounts/sign-account-amendment',
            params: { accountId },
          })
        }
      >
        {hubDisabled ? 'Change blocked (pending)' : 'Manage contract & billing'}
      </Button>
      {pendingAmendment && onResendEmail ? (
        <Button
          variant="outline"
          size="sm"
          disabled={savingAction}
          onPress={onResendEmail}
        >
          Resend acceptance email
        </Button>
      ) : null}
    </View>
  );
}

export function PlatformAccountDetailMobileActions(props: PlatformAccountDetailActionsProps) {
  return <PlatformAccountDetailDesktopActions {...props} />;
}
