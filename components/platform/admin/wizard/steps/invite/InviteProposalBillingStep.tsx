import { View } from 'react-native';
import { AgreementTypeSelector, ProposalPlanFields } from '@/components/platform/admin/wizard';
import { InviteBillingStep } from '@/components/platform/admin/wizard/steps/invite/InviteBillingStep';
import type { AgreementType } from '@/lib/platform/contract/terms';
import type { ProposalPlanTier } from '@/lib/platform/contract/proposalPlans';

type InviteProposalBillingStepProps = {
  agreementType: AgreementType;
  onAgreementTypeChange: (value: AgreementType) => void;
  isManagedServices: boolean;
  inviteMonthlyRetainer: string;
  onInviteMonthlyRetainerChange: (value: string) => void;
  autoAddInternalAdmins: boolean;
  onAutoAddInternalAdminsChange: (value: boolean) => void;
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

export function InviteProposalBillingStep({
  agreementType,
  onAgreementTypeChange,
  isManagedServices,
  inviteMonthlyRetainer,
  onInviteMonthlyRetainerChange,
  autoAddInternalAdmins,
  onAutoAddInternalAdminsChange,
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
}: InviteProposalBillingStepProps) {
  return (
    <View className="gap-4">
      <AgreementTypeSelector value={agreementType} onChange={onAgreementTypeChange} />
      <InviteBillingStep
        inviteMonthlyRetainer={inviteMonthlyRetainer}
        onInviteMonthlyRetainerChange={onInviteMonthlyRetainerChange}
        autoAddInternalAdmins={autoAddInternalAdmins}
        onAutoAddInternalAdminsChange={onAutoAddInternalAdminsChange}
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
