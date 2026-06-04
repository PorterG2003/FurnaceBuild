import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { formatUsd } from '@/components/platform/admin/shared';
import { PlatformAcceptExperience } from '@/components/platform/contract/PlatformAcceptExperience';
import {
  PlatformContractReviewFlow,
  type PlatformContractReviewStep,
} from '@/components/platform/contract/PlatformContractReviewFlow';
import type {
  AmendmentAcceptFlowKind,
  AmendmentBillingChangeKind,
} from '@/lib/platform/amendment/acceptFlow';
import type { PlatformAccountAmendmentInfo } from '@/lib/supabase/services/platform';

export function PlatformAmendmentAcceptExperience({
  info,
  acceptFlowKind,
  billingChangeKind,
  ownerPhase,
  saving,
  onContinue,
}: {
  info: PlatformAccountAmendmentInfo;
  acceptFlowKind: AmendmentAcceptFlowKind;
  billingChangeKind: AmendmentBillingChangeKind;
  ownerPhase: 'review' | 'payment';
  saving: boolean;
  onContinue: () => void;
}) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [reviewStep, setReviewStep] = useState<PlatformContractReviewStep>('terms');

  useEffect(() => {
    setTermsAccepted(false);
    setReviewStep(acceptFlowKind === 'full_proposal' ? 'proposal' : 'terms');
  }, [acceptFlowKind, info.amendment_id]);

  const retainerChanged =
    info.current_monthly_retainer_cents != null &&
    info.proposed_monthly_retainer_cents != null &&
    info.current_monthly_retainer_cents !== info.proposed_monthly_retainer_cents;

  const showsProposal = acceptFlowKind === 'full_proposal';
  const isUpgrade = billingChangeKind === 'upgrade';
  const isPaymentPending = isUpgrade && info.status === 'pending_payment';
  const stepLabel = isUpgrade ? 'Step 1 of 2' : 'Final step';
  const title = showsProposal ? 'Review agreement update' : 'Review terms update';
  const continueLabel = isPaymentPending ? 'Back to payment' : isUpgrade ? 'Continue to payment' : 'Accept and continue';
  const continueLoadingLabel = isUpgrade ? 'Continuing...' : 'Accepting...';
  const termsAcceptanceLabel = isUpgrade
    ? 'I have reviewed this agreement, and I understand that confirming payment will make it binding.'
    : 'I have reviewed this agreement, and I agree that accepting it will make it binding.';
  const introCopy = isUpgrade
    ? isPaymentPending
      ? `Payment is still required for ${info.account_name}. Re-review the updated agreement below, then return to payment when you are ready to finish applying it.`
      : `Review the updated agreement for ${info.account_name}. After this step, you will choose a payment method and confirm the charge before the new terms take effect.`
    : `Review the updated agreement for ${info.account_name}. Accepting it will update the active contract for this workspace.`;
  const reviewSummaryCopy = isUpgrade
    ? 'This upgrade has two steps: review the agreement now, then choose a payment method and confirm payment.'
    : 'Review the updated terms below, then accept to make this agreement active.';

  return (
    <PlatformAcceptExperience contentMode={showsProposal && reviewStep === 'proposal' ? 'transparent' : 'framed'}>
      <PlatformContractReviewFlow
        agreementType={info.agreement_type}
        proposalSnapshot={info.proposal_snapshot_json}
        termsMarkdown={info.terms_snapshot_markdown}
        showProposalStep={showsProposal}
        initialStep={showsProposal ? 'proposal' : 'terms'}
        termsAccepted={termsAccepted}
        onTermsAcceptedChange={setTermsAccepted}
        termsAcceptanceLabel={termsAcceptanceLabel}
        continueLabel={continueLabel}
        continueLoading={saving}
        continueLoadingLabel={continueLoadingLabel}
        onContinue={onContinue}
        onStepChange={setReviewStep}
        proposalContinueLabel="Continue to terms"
        proposalBackLabel="Back to proposal"
        header={
          <>
            <View className="gap-2">
              <Text className="text-brand-orange text-xs font-instrument-semibold uppercase tracking-[2px]">
                {stepLabel}
              </Text>
              <Text className="text-white font-instrument-semibold text-3xl">{title}</Text>
              <Text className="text-gray-300 font-instrument">{introCopy}</Text>
            </View>

            <View className="rounded-xl border border-[#2A2A2A] bg-[#181818] p-4 gap-2">
              <Text className="text-white font-instrument-medium">What happens on this page</Text>
              <Text className="text-gray-300 font-instrument text-sm">{reviewSummaryCopy}</Text>
              {isUpgrade && ownerPhase === 'review' ? (
                <Text className="text-gray-400 font-instrument text-sm">
                  The agreement does not take effect until the payment step is completed.
                </Text>
              ) : null}
            </View>

            {retainerChanged ? (
              <View className="rounded-xl border border-[#2A2A2A] bg-[#181818] p-4 gap-2">
                <Text className="text-white font-instrument-medium">Billing change</Text>
                <Text className="text-gray-300 font-instrument text-sm">
                  Monthly retainer: {formatUsd(info.current_monthly_retainer_cents ?? 0)} →{' '}
                  {formatUsd(info.proposed_monthly_retainer_cents ?? 0)}
                </Text>
                {(info.proposed_monthly_retainer_cents ?? 0) >
                (info.current_monthly_retainer_cents ?? 0) ? (
                  <Text className="text-gray-400 font-instrument text-sm">
                    On the next step, the owner chooses between card and ACH, reviews the updated
                    totals, and confirms payment before this agreement becomes active.
                  </Text>
                ) : (
                  <Text className="text-gray-400 font-instrument text-sm">
                    The lower retainer takes effect on the next billing cycle.
                  </Text>
                )}
              </View>
            ) : null}
          </>
        }
      />
    </PlatformAcceptExperience>
  );
}
