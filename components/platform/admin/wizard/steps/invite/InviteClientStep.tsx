import { TextInput, View } from 'react-native';
import { FormFieldGroup } from '@/components/ui/forms/FormFieldGroup';
import {
  authInputClassName,
  authInputStyle,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';

type InviteClientStepProps = {
  inviteEmail: string;
  onInviteEmailChange: (value: string) => void;
  inviteCompanyName: string;
  onInviteCompanyNameChange: (value: string) => void;
};

export function InviteClientStep({
  inviteEmail,
  onInviteEmailChange,
  inviteCompanyName,
  onInviteCompanyNameChange,
}: InviteClientStepProps) {
  return (
    <View className="gap-2">
      <FormFieldGroup label="Invite email">
        <TextInput
          value={inviteEmail}
          onChangeText={onInviteEmailChange}
          placeholder="client@company.com"
          placeholderTextColor={authPlaceholderColor}
          className={authInputClassName}
          style={authInputStyle}
          autoCapitalize="none"
        />
      </FormFieldGroup>
      <FormFieldGroup label="Proposed company or workspace name">
        <TextInput
          value={inviteCompanyName}
          onChangeText={onInviteCompanyNameChange}
          placeholder="Sisu"
          placeholderTextColor={authPlaceholderColor}
          className={authInputClassName}
          style={authInputStyle}
        />
      </FormFieldGroup>
    </View>
  );
}
