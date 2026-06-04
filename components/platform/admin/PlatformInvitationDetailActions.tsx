import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { MobileHeaderButton } from '@/components/ui/MobileHeaderButton';
import { BottomSheet } from '@/components/ui/modals/BottomSheet';
import { getInvitationPublishActionLabel } from '@/lib/platform/invite/invitationAdminState';

export type PlatformInvitationDetailActionsProps = {
  invitation: {
    id: string;
    status: string;
    current_revision_number: number;
    published_revision_number: number | null;
  };
  canEditInvitation: boolean;
  canPublishInvitation: boolean;
  canUnpublishInvitation: boolean;
  canRevokeInvitation: boolean;
  savingAction: boolean;
  publishLabel: string;
  onCopyInvite: () => void;
  onOpenInvite: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onRevoke: () => void;
};

function MobileSheetRow({
  label,
  onPress,
  disabled,
  destructive,
  isLast,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: '#2A2A2A',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Text
        className={`font-instrument-medium text-base ${
          destructive ? 'text-red-400' : 'text-white'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function PlatformInvitationDetailDesktopActions({
  invitation,
  canEditInvitation,
  canPublishInvitation,
  canUnpublishInvitation,
  canRevokeInvitation,
  savingAction,
  publishLabel,
  onCopyInvite,
  onOpenInvite,
  onPublish,
  onUnpublish,
  onRevoke,
}: PlatformInvitationDetailActionsProps) {
  const router = useRouter();

  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {canEditInvitation ? (
        <Button
          variant="outline"
          size="sm"
          onPress={() =>
            router.push({
              pathname: '/admin/accounts/sign-new-client',
              params: { invitationId: invitation.id },
            })
          }
        >
          Edit
        </Button>
      ) : null}
      {canUnpublishInvitation ? (
        <Button variant="outline" size="sm" onPress={onUnpublish} disabled={savingAction}>
          Unpublish
        </Button>
      ) : null}
      {canPublishInvitation ? (
        <Button size="sm" onPress={onPublish} disabled={savingAction}>
          {publishLabel}
        </Button>
      ) : null}
      {invitation.published_revision_number ? (
        <Button variant="outline" size="sm" onPress={onCopyInvite}>
          Copy Invite Link
        </Button>
      ) : null}
      {invitation.published_revision_number ? (
        <Button variant="outline" size="sm" onPress={onOpenInvite}>
          Open Invite
        </Button>
      ) : null}
      {canRevokeInvitation ? (
        <Button variant="destructive" size="sm" onPress={onRevoke}>
          Revoke
        </Button>
      ) : null}
    </View>
  );
}

export function PlatformInvitationDetailMobileActions(props: PlatformInvitationDetailActionsProps) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const {
    invitation,
    canEditInvitation,
    canPublishInvitation,
    canUnpublishInvitation,
    canRevokeInvitation,
    savingAction,
    publishLabel,
    onCopyInvite,
    onOpenInvite,
    onPublish,
    onUnpublish,
    onRevoke,
  } = props;

  const closeSheet = () => setSheetOpen(false);

  const rows: Array<{
    key: string;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    destructive?: boolean;
  }> = [];

  if (canEditInvitation) {
    rows.push({
      key: 'edit',
      label: 'Edit',
      onPress: () => {
        closeSheet();
        router.push({
          pathname: '/admin/accounts/sign-new-client',
          params: { invitationId: invitation.id },
        });
      },
    });
  }
  if (canUnpublishInvitation) {
    rows.push({
      key: 'unpublish',
      label: 'Unpublish',
      onPress: () => {
        onUnpublish();
        closeSheet();
      },
      disabled: savingAction,
    });
  }
  if (canPublishInvitation) {
    rows.push({
      key: 'publish',
      label: publishLabel,
      onPress: () => {
        onPublish();
        closeSheet();
      },
      disabled: savingAction,
    });
  }
  if (invitation.published_revision_number) {
    rows.push({
      key: 'copy',
      label: 'Copy Invite Link',
      onPress: () => {
        void onCopyInvite();
        closeSheet();
      },
    });
    rows.push({
      key: 'open',
      label: 'Open Invite',
      onPress: () => {
        onOpenInvite();
        closeSheet();
      },
    });
  }
  if (canRevokeInvitation) {
    rows.push({
      key: 'revoke',
      label: 'Revoke',
      onPress: () => {
        onRevoke();
        closeSheet();
      },
      destructive: true,
    });
  }

  return (
    <>
      <MobileHeaderButton
        variant="actions"
        onPress={() => setSheetOpen(true)}
        accessibilityLabel="Invitation actions"
      />
      <BottomSheet visible={sheetOpen} onClose={closeSheet}>
        {rows.map((row, index) => (
          <MobileSheetRow
            key={row.key}
            label={row.label}
            onPress={row.onPress}
            disabled={row.disabled}
            destructive={row.destructive}
            isLast={index === rows.length - 1}
          />
        ))}
      </BottomSheet>
    </>
  );
}

export function getPlatformInvitationPublishLabel(
  invitation: PlatformInvitationDetailActionsProps['invitation'],
): string {
  return getInvitationPublishActionLabel(invitation);
}
