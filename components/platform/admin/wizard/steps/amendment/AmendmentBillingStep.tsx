import { Text, TextInput, View } from 'react-native';
import { FormFieldGroup } from '@/components/ui/forms/FormFieldGroup';
import { AgreementTypeSelector } from '@/components/platform/admin/wizard';
import {
  authInputClassName,
  authInputStyle,
} from '@/components/auth/authFormStyles';
import type { AgreementType } from '@/lib/platform/contract/terms';

type AmendmentBillingStepProps = {
  accountName: string;
  onAccountNameChange: (value: string) => void;
  agreementType: AgreementType;
  onAgreementTypeChange: (value: AgreementType) => void;
  monthlyRetainer: string;
  onMonthlyRetainerChange: (value: string) => void;
  ownerEmail: string;
};

export function AmendmentBillingStep({
  accountName,
  onAccountNameChange,
  agreementType,
  onAgreementTypeChange,
  monthlyRetainer,
  onMonthlyRetainerChange,
  ownerEmail,
}: AmendmentBillingStepProps) {
  return (
    <View className="gap-4">
      <FormFieldGroup label="Account name">
        <TextInput
          value={accountName}
          onChangeText={onAccountNameChange}
          className={authInputClassName}
          style={authInputStyle}
        />
      </FormFieldGroup>
      <AgreementTypeSelector value={agreementType} onChange={onAgreementTypeChange} />
      <FormFieldGroup label="Monthly retainer (USD)">
        <TextInput
          value={monthlyRetainer}
          onChangeText={onMonthlyRetainerChange}
          keyboardType="numeric"
          className={authInputClassName}
          style={authInputStyle}
        />
      </FormFieldGroup>
      <Text className="text-gray-400 font-instrument text-sm">Owner email: {ownerEmail || '—'}</Text>
    </View>
  );
}
