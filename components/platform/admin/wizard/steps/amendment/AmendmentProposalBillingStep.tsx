import { View } from 'react-native';
import { ProposalPlanFields } from '@/components/platform/admin/wizard';
import { AmendmentBillingStep } from './AmendmentBillingStep';
import type { AgreementType } from '@/lib/platform/contract/terms';
import type { ProposalPlanTier } from '@/lib/platform/contract/proposalPlans';

type AmendmentProposalBillingStepProps = {
  accountName: string;
  onAccountNameChange: (value: string) => void;
  agreementType: AgreementType;
  onAgreementTypeChange: (value: AgreementType) => void;
  monthlyRetainer: string;
  onMonthlyRetainerChange: (value: string) => void;
  ownerEmail: string;
  isManagedServices: boolean;
  planTier: ProposalPlanTier;
  onPlanTierChange: (value: ProposalPlanTier) => void;
  websiteTrafficSourcingEnabled: boolean;
  onWebsiteTrafficSourcingEnabledChange: (value: boolean) => void;
  replyHandlingEnabled: boolean;
  onReplyHandlingEnabledChange: (value: boolean) => void;
  managedOutreachVolume: string;
  onManagedOutreachVolumeChange: (value: string) => void;
  managedInboxCount: string;
  onManagedInboxCountChange: (value: string) => void;
};

export function AmendmentProposalBillingStep({
  accountName,
  onAccountNameChange,
  agreementType,
  onAgreementTypeChange,
  monthlyRetainer,
  onMonthlyRetainerChange,
  ownerEmail,
  isManagedServices,
  planTier,
  onPlanTierChange,
  websiteTrafficSourcingEnabled,
  onWebsiteTrafficSourcingEnabledChange,
  replyHandlingEnabled,
  onReplyHandlingEnabledChange,
  managedOutreachVolume,
  onManagedOutreachVolumeChange,
  managedInboxCount,
  onManagedInboxCountChange,
}: AmendmentProposalBillingStepProps) {
  return (
    <View className="gap-4">
      <AmendmentBillingStep
        accountName={accountName}
        onAccountNameChange={onAccountNameChange}
        agreementType={agreementType}
        onAgreementTypeChange={onAgreementTypeChange}
        monthlyRetainer={monthlyRetainer}
        onMonthlyRetainerChange={onMonthlyRetainerChange}
        ownerEmail={ownerEmail}
      />
      <ProposalPlanFields
        isManagedServices={isManagedServices}
        planTier={planTier}
        onPlanTierChange={onPlanTierChange}
        websiteTrafficSourcingEnabled={websiteTrafficSourcingEnabled}
        onWebsiteTrafficSourcingEnabledChange={onWebsiteTrafficSourcingEnabledChange}
        replyHandlingEnabled={replyHandlingEnabled}
        onReplyHandlingEnabledChange={onReplyHandlingEnabledChange}
        managedOutreachVolume={managedOutreachVolume}
        onManagedOutreachVolumeChange={onManagedOutreachVolumeChange}
        managedInboxCount={managedInboxCount}
        onManagedInboxCountChange={onManagedInboxCountChange}
      />
    </View>
  );
}
