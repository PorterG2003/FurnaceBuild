import { Text, View } from 'react-native';
import type { PendingPlatformAccountAmendment } from '@/lib/supabase/services/platform';

type PendingTermsBannerProps = {
  pendingAmendment: PendingPlatformAccountAmendment;
};

export function PendingTermsBanner({ pendingAmendment }: PendingTermsBannerProps) {
  const isPendingPayment = pendingAmendment.status === 'pending_payment';

  return (
    <View className="bg-amber-950/80 border-b border-amber-700/60 px-4 py-3">
      <Text className="text-amber-100 font-instrument-medium text-sm">
        {isPendingPayment ? 'Agreement payment pending' : 'Agreement update pending'}
      </Text>
      <Text className="text-amber-200/90 font-instrument text-sm mt-1">
        {isPendingPayment
          ? `The account owner must finish payment for ${pendingAmendment.account_name}. You can continue working until they complete the upgrade.`
          : `The account owner must accept updated terms for ${pendingAmendment.account_name}. You can continue working until they complete acceptance.`}
      </Text>
    </View>
  );
}
