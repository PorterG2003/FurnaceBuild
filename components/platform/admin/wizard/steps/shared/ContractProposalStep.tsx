import { View } from 'react-native';
import { AgreementTypeSelector, ProposalPlanFields } from '@/components/platform/admin/wizard';
import type { AgreementType } from '@/lib/platform/contract/terms';
import type { ProposalPlanTier } from '@/lib/platform/contract/proposalPlans';

type ContractProposalStepProps = {
  agreementType: AgreementType;
  onAgreementTypeChange: (value: AgreementType) => void;
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
  showAgreementTypeSelector?: boolean;
};

export function ContractProposalStep({
  agreementType,
  onAgreementTypeChange,
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
  showAgreementTypeSelector = true,
}: ContractProposalStepProps) {
  return (
    <View className="gap-4">
      {showAgreementTypeSelector ? (
        <AgreementTypeSelector value={agreementType} onChange={onAgreementTypeChange} />
      ) : null}
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
