import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useAccount } from '@/contexts/AccountContext';
import type { PendingPlatformAccountAmendment } from '@/lib/supabase/services/platform';
import {
  isPendingAmendmentStatus,
  resolveAmendmentAcceptFlowFromBilling,
  type AmendmentAcceptFlowKind,
} from '@/lib/platform/amendment/acceptFlow';
import { normalizeAgreementType } from '@/lib/platform/contract/terms';

type TermsAcceptanceRequiredScreenProps = {
  pendingAmendment: PendingPlatformAccountAmendment;
};

export function TermsAcceptanceRequiredScreen({
  pendingAmendment,
}: TermsAcceptanceRequiredScreenProps) {
  const router = useRouter();
  const { signOut } = useAuth();
  const { account, billing } = useAccount();
  const [navigating, setNavigating] = useState(false);

  const acceptFlowKind: AmendmentAcceptFlowKind = useMemo(() => {
    if (!billing) return 'terms_only';
    return resolveAmendmentAcceptFlowFromBilling(billing, {
      monthly_retainer_cents: pendingAmendment.monthly_retainer_cents,
      agreement_type: normalizeAgreementType(pendingAmendment.agreement_type),
      proposal_snapshot_json: pendingAmendment.proposal_snapshot_json ?? {},
    });
  }, [billing, pendingAmendment]);

  const isFullFlow = acceptFlowKind === 'full_proposal';
  const isPendingPayment = isPendingAmendmentStatus(pendingAmendment.status)
    ? pendingAmendment.status === 'pending_payment'
    : false;

  return (
    <View className="flex-1 items-center justify-center bg-[#121212] px-6">
      <View className="w-full max-w-lg rounded-2xl border border-[#2A2A2A] bg-[#181818] p-6">
        <Text className="text-center text-3xl font-instrument-semibold text-white mb-3">
          {isPendingPayment ? 'Complete payment' : isFullFlow ? 'Updated agreement' : 'Updated terms'}
        </Text>
        <Text className="text-center text-gray-300 font-instrument mb-6">
          {isPendingPayment
            ? `${account?.name ?? pendingAmendment.account_name} still needs the account owner to finish payment before these changes can take effect.`
            : `${account?.name ?? pendingAmendment.account_name} has ${
                isFullFlow
                  ? 'contract and billing changes that require your review and acceptance'
                  : 'updated terms that require your acceptance'
              } as the account owner before you can continue using Furnace.`}
        </Text>
        <Button
          className="mb-3"
          disabled={navigating}
          onPress={() => {
            setNavigating(true);
            router.replace(`/accept-account-amendment/${pendingAmendment.amendment_id}`);
          }}
        >
          {isPendingPayment
            ? 'Complete payment'
            : isFullFlow
              ? 'Review agreement changes'
              : 'Review and accept terms'}
        </Button>
        <Button variant="outline" onPress={() => { void signOut(); }}>
          Sign out
        </Button>
      </View>
    </View>
  );
}
