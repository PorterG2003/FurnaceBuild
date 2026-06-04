import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/Checkbox';
import { PlatformProposalPreview } from '@/components/platform/admin/PlatformProposalPreview';
import type { AgreementType } from '@/lib/platform/contract/terms';
import { normalizeAgreementType } from '@/lib/platform/contract/terms';
import { PlatformTermsMarkdown } from './PlatformTermsMarkdown';

export type PlatformContractReviewStep = 'proposal' | 'terms';

type PlatformContractReviewFlowProps = {
  agreementType?: AgreementType | null;
  proposalSnapshot?: Record<string, unknown> | null;
  termsMarkdown?: string | null;
  showProposalStep?: boolean;
  initialStep?: PlatformContractReviewStep;
  termsAccepted: boolean;
  onTermsAcceptedChange: (checked: boolean) => void;
  termsAcceptanceLabel: string;
  continueLabel: string;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  continueLoadingLabel?: string;
  onContinue: () => void;
  onStepChange?: (step: PlatformContractReviewStep) => void;
  proposalContinueLabel?: string;
  proposalBackLabel?: string;
  header?: ReactNode;
};

export function PlatformContractReviewFlow({
  agreementType,
  proposalSnapshot,
  termsMarkdown,
  showProposalStep,
  initialStep,
  termsAccepted,
  onTermsAcceptedChange,
  termsAcceptanceLabel,
  continueLabel,
  continueDisabled = false,
  continueLoading = false,
  continueLoadingLabel = continueLabel,
  onContinue,
  onStepChange,
  proposalContinueLabel = 'Continue to terms',
  proposalBackLabel = 'Back to proposal',
  header,
}: PlatformContractReviewFlowProps) {
  const proposalEnabled =
    showProposalStep ?? normalizeAgreementType(agreementType) === 'managed_services_agreement';
  const defaultStep: PlatformContractReviewStep = proposalEnabled ? 'proposal' : 'terms';
  const [step, setStep] = useState<PlatformContractReviewStep>(initialStep ?? defaultStep);

  useEffect(() => {
    setStep(initialStep ?? defaultStep);
  }, [defaultStep, initialStep, proposalSnapshot, termsMarkdown]);

  const goToStep = (nextStep: PlatformContractReviewStep) => {
    setStep(nextStep);
    onStepChange?.(nextStep);
  };

  return (
    <View className="gap-6">
      {header}

      {proposalEnabled && step === 'proposal' ? (
        <PlatformProposalPreview
          proposalSnapshot={proposalSnapshot ?? {}}
          footer={<Button onPress={() => goToStep('terms')}>{proposalContinueLabel}</Button>}
        />
      ) : null}

      {step === 'terms' ? (
        <View className="gap-6">
          <PlatformTermsMarkdown markdown={termsMarkdown || 'Terms will be attached here.'} />

          <View className="flex-row items-center gap-3">
            <Checkbox
              checked={termsAccepted}
              onPress={() => onTermsAcceptedChange(!termsAccepted)}
            />
            <Pressable
              className="flex-1"
              onPress={() => onTermsAcceptedChange(!termsAccepted)}
            >
              <Text selectable={false} className="text-gray-300 font-instrument">
                {termsAcceptanceLabel}
              </Text>
            </Pressable>
          </View>

          <View className="flex-row gap-3">
            {proposalEnabled ? (
              <Button variant="outline" className="flex-1" onPress={() => goToStep('proposal')}>
                {proposalBackLabel}
              </Button>
            ) : null}
            <Button
              className="flex-1"
              onPress={onContinue}
              disabled={continueLoading || continueDisabled || !termsAccepted}
            >
              {continueLoading ? continueLoadingLabel : continueLabel}
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}
