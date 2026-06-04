import { Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { formatUsd } from '@/components/platform/admin/shared';
import { buildAmendmentAcceptUrl } from '@/lib/platform/amendment/acceptFlow';
import type { PlatformAccountAmendment } from '@/lib/supabase/services/platform';

type PlatformAccountPendingAmendmentCardProps = {
  pendingAmendment: PlatformAccountAmendment;
  currentRetainerCents: number;
  proposedRetainerCents?: number | null;
  savingAction?: boolean;
  onResendEmail: () => void;
  onCopyLink: () => void;
  formatTimestamp: (value: string | null) => string;
};

export function PlatformAccountPendingAmendmentCard({
  pendingAmendment,
  currentRetainerCents,
  proposedRetainerCents,
  savingAction,
  onResendEmail,
  onCopyLink,
  formatTimestamp,
}: PlatformAccountPendingAmendmentCardProps) {
  const acceptUrl = buildAmendmentAcceptUrl(pendingAmendment.id);
  const retainerChanged =
    proposedRetainerCents != null && proposedRetainerCents !== currentRetainerCents;
  const awaitingPayment = pendingAmendment.status === 'pending_payment';

  return (
    <View className="rounded-2xl border border-amber-700/50 bg-amber-950/30 p-5 gap-4">
      <View>
        <Text className="text-amber-100 font-instrument-semibold text-lg">
          {awaitingPayment ? 'Pending owner payment' : 'Pending owner acceptance'}
        </Text>
        <Text className="text-amber-200/80 font-instrument text-sm mt-1">
          Published {formatTimestamp(pendingAmendment.published_at ?? pendingAmendment.updated_at)}.
          {awaitingPayment
            ? ' The owner still needs to complete payment before these changes apply. New amendments are blocked until this resolves.'
            : ' The owner must accept before changes apply. New amendments are blocked until this resolves.'}
        </Text>
      </View>
      {retainerChanged ? (
        <Text className="text-amber-100 font-instrument text-sm">
          Proposed retainer: {formatUsd(currentRetainerCents)} → {formatUsd(proposedRetainerCents!)}
        </Text>
      ) : null}
      <Text className="text-amber-200/70 font-instrument text-xs" selectable>
        {acceptUrl}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Button variant="outline" size="sm" onPress={onCopyLink}>
          Copy accept link
        </Button>
        <Button size="sm" disabled={savingAction} onPress={onResendEmail}>
          Resend email
        </Button>
      </View>
    </View>
  );
}
