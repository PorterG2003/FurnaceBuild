import { useMemo } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Toggle } from '@/components/ui/Toggle';
import { FormFieldGroup } from '@/components/ui/forms/FormFieldGroup';
import { SegmentControl } from '@/components/ui/segment-control';
import { formatUsd } from '@/components/platform/admin/shared';
import {
  authInputClassName,
  authInputStyle,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';
import type { PlatformInviteProrationMode } from '@/lib/billing/proration';
import { buildInviteProrationSummary } from '@/lib/platform/invite/prorationSummary';
import { parseInviteWizardUsdInputToCents } from '@/lib/platform/invite/wizard';

type InviteBillingStepProps = {
  inviteMonthlyRetainer: string;
  onInviteMonthlyRetainerChange: (value: string) => void;
  inviteProrationMode: PlatformInviteProrationMode;
  onInviteProrationModeChange: (value: PlatformInviteProrationMode) => void;
  prorationClauseUnmatched?: boolean;
  autoAddInternalAdmins: boolean;
  onAutoAddInternalAdminsChange: (value: boolean) => void;
};

export function InviteBillingStep({
  inviteMonthlyRetainer,
  onInviteMonthlyRetainerChange,
  inviteProrationMode,
  onInviteProrationModeChange,
  prorationClauseUnmatched = false,
  autoAddInternalAdmins,
  onAutoAddInternalAdminsChange,
}: InviteBillingStepProps) {
  const monthlyRetainerCents = useMemo(
    () => parseInviteWizardUsdInputToCents(inviteMonthlyRetainer),
    [inviteMonthlyRetainer],
  );
  // Free invites skip Stripe entirely, so a proration choice would have no effect.
  const showProrationControl = monthlyRetainerCents != null && monthlyRetainerCents > 0;
  const prorationSummary = useMemo(() => {
    if (!showProrationControl || monthlyRetainerCents == null) return null;
    return buildInviteProrationSummary({
      monthlyRetainerCents,
      prorationMode: inviteProrationMode,
      formatAmount: formatUsd,
    });
  }, [inviteProrationMode, monthlyRetainerCents, showProrationControl]);

  return (
    <View className="gap-2">
      <FormFieldGroup label="Monthly retainer (USD)">
        <TextInput
          value={inviteMonthlyRetainer}
          onChangeText={onInviteMonthlyRetainerChange}
          placeholder="1800"
          placeholderTextColor={authPlaceholderColor}
          className={authInputClassName}
          style={authInputStyle}
          keyboardType="numeric"
        />
        <Text className="mt-2 text-sm text-gray-400 font-instrument">
          Enter `0` for a free account.
        </Text>
      </FormFieldGroup>

      {showProrationControl ? (
        <FormFieldGroup label="First invoice">
          <SegmentControl
            options={[
              { value: 'second_month', label: 'Full month today' },
              { value: 'first_month', label: 'Prorate today' },
            ]}
            value={inviteProrationMode}
            onChange={(next) => onInviteProrationModeChange(next as PlatformInviteProrationMode)}
          />
          {prorationSummary ? (
            <Text className="mt-2 text-sm text-gray-300 font-instrument">{prorationSummary}</Text>
          ) : null}
          <Text className="mt-1 text-sm text-gray-500 font-instrument">
            Final amounts depend on the date the client accepts.
          </Text>
          {prorationClauseUnmatched ? (
            <Text className="mt-2 text-sm text-amber-400 font-instrument">
              The agreement has been edited, so its proration clause was left as-is. Update the
              billing section manually to match this choice.
            </Text>
          ) : null}
        </FormFieldGroup>
      ) : null}

      <View className="mb-5 flex-row items-center justify-between gap-3 rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
        <Text className="flex-1 text-gray-300 font-instrument">
          Auto-add `porter@getfurnace.io` and `kyle@getfurnace.io` as admins
        </Text>
        <Toggle value={autoAddInternalAdmins} onValueChange={onAutoAddInternalAdminsChange} />
      </View>
    </View>
  );
}
