import { Text, TextInput, View } from 'react-native';
import { FormFieldGroup } from '@/components/ui/forms/FormFieldGroup';
import { SettingToggleRow } from '@/components/ui/forms/SettingToggleRow';
import { SegmentControl } from '@/components/ui/segment-control';
import {
  authInputClassName,
  authInputStyle,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';
import {
  PROPOSAL_PLAN_TIER_OPTIONS,
  type ProposalPlanTier,
} from '@/lib/platform/contract/proposalPlans';

type ProposalPlanFieldsProps = {
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

export function ProposalPlanFields({
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
}: ProposalPlanFieldsProps) {
  if (!isManagedServices) {
    return (
      <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
        <Text className="text-white font-instrument-medium">Platform access invite</Text>
        <Text className="mt-1 text-sm font-instrument text-gray-400">
          This agreement path grants access to Furnace without a plan tier, add-ons, or
          managed-services proposal.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-4">
      <FormFieldGroup label="Plan tier">
        <SegmentControl
          options={PROPOSAL_PLAN_TIER_OPTIONS.map((option) => ({
            value: option.id,
            label: option.label,
          }))}
          value={planTier}
          onChange={(next) => onPlanTierChange(next as ProposalPlanTier)}
        />
      </FormFieldGroup>
      <View className="gap-3 mb-4">
        <SettingToggleRow
          label="Website traffic sourcing"
          description="Show this proposal with website traffic sourcing enabled as an add-on."
          value={websiteTrafficSourcingEnabled}
          onValueChange={onWebsiteTrafficSourcingEnabledChange}
        />
        <SettingToggleRow
          label="Reply handling"
          description="Show this proposal with reply handling enabled as an add-on."
          value={replyHandlingEnabled}
          onValueChange={onReplyHandlingEnabledChange}
        />
      </View>
      <View className="flex-row gap-4">
        <View className="flex-1">
          <FormFieldGroup label="Outreach volume (emails/month)">
            <TextInput
              value={managedOutreachVolume}
              onChangeText={onManagedOutreachVolumeChange}
              placeholder="5000"
              placeholderTextColor={authPlaceholderColor}
              className={authInputClassName}
              style={authInputStyle}
              keyboardType="numeric"
            />
          </FormFieldGroup>
        </View>
        <View className="flex-1">
          <FormFieldGroup label="Sending inbox count">
            <TextInput
              value={managedInboxCount}
              onChangeText={onManagedInboxCountChange}
              placeholder="25"
              placeholderTextColor={authPlaceholderColor}
              className={authInputClassName}
              style={authInputStyle}
              keyboardType="numeric"
            />
          </FormFieldGroup>
        </View>
      </View>
    </View>
  );
}
