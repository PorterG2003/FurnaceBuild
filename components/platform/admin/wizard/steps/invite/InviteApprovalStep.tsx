import { Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { formatUsd } from '@/components/platform/admin/shared';
import { getAgreementTypeLabel, type AgreementType } from '@/lib/platform/contract/terms';

type InviteApprovalStepProps = {
  inviteEmail: string;
  inviteCompanyName: string;
  monthlyRetainerCents: number | null;
  agreementType: AgreementType;
  isManagedServicesAgreement: boolean;
  managedOutreachVolume: string;
  managedInboxCount: string;
  currentPlanLabel: string;
  saving: boolean;
  onBack: () => void;
  onSaveDraft: () => void;
  onPublish: () => void;
};

export function InviteApprovalStep({
  inviteEmail,
  inviteCompanyName,
  monthlyRetainerCents,
  agreementType,
  isManagedServicesAgreement,
  managedOutreachVolume,
  managedInboxCount,
  currentPlanLabel,
  saving,
  onBack,
  onSaveDraft,
  onPublish,
}: InviteApprovalStepProps) {
  return (
    <View className="gap-4">
      <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
        <Text className="text-white text-xl font-instrument-semibold mb-3">Approval checklist</Text>
        <Text className="text-gray-300 font-instrument">
          Email will not be sent until you explicitly approve and send. Saving a draft keeps this package internal.
        </Text>
        <View className="mt-4 gap-2">
          <Text className="text-gray-400 font-instrument">Client: {inviteEmail || 'Missing email'}</Text>
          <Text className="text-gray-400 font-instrument">
            Company: {inviteCompanyName || 'No proposed company name'}
          </Text>
          <Text className="text-gray-400 font-instrument">
            Retainer: {formatUsd(monthlyRetainerCents ?? 0)}
          </Text>
          <Text className="text-gray-400 font-instrument">
            Agreement: {getAgreementTypeLabel(agreementType)}
          </Text>
          {isManagedServicesAgreement ? (
            <>
              <Text className="text-gray-400 font-instrument">
                Outreach volume: {managedOutreachVolume || 'Missing'}
              </Text>
              <Text className="text-gray-400 font-instrument">
                Inbox count: {managedInboxCount || 'Missing'}
              </Text>
              <Text className="text-gray-400 font-instrument">Plan: {currentPlanLabel}</Text>
            </>
          ) : null}
        </View>
      </View>

      <View className="gap-3">
        <Button variant="outline" onPress={onBack} disabled={saving}>
          Back
        </Button>
        <Button variant="secondary" onPress={onSaveDraft} disabled={saving}>
          {saving ? 'Saving' : 'Save'}
        </Button>
        <Button onPress={onPublish} disabled={saving}>
          {saving ? 'Publishing' : 'Publish'}
        </Button>
      </View>
    </View>
  );
}
