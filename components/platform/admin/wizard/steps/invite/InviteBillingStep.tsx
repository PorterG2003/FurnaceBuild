import { Text, TextInput, View } from 'react-native';
import { Toggle } from '@/components/ui/Toggle';
import { FormFieldGroup } from '@/components/ui/forms/FormFieldGroup';
import {
  authInputClassName,
  authInputStyle,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';

type InviteBillingStepProps = {
  inviteMonthlyRetainer: string;
  onInviteMonthlyRetainerChange: (value: string) => void;
  autoAddInternalAdmins: boolean;
  onAutoAddInternalAdminsChange: (value: boolean) => void;
};

export function InviteBillingStep({
  inviteMonthlyRetainer,
  onInviteMonthlyRetainerChange,
  autoAddInternalAdmins,
  onAutoAddInternalAdminsChange,
}: InviteBillingStepProps) {
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
      <View className="mb-5 flex-row items-center justify-between gap-3 rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
        <Text className="flex-1 text-gray-300 font-instrument">
          Auto-add `porter@getfurnace.io` and `kyle@getfurnace.io` as admins
        </Text>
        <Toggle value={autoAddInternalAdmins} onValueChange={onAutoAddInternalAdminsChange} />
      </View>
    </View>
  );
}
