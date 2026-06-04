import { Text, View } from 'react-native';
import { FormTextField } from '@/components/ui/forms/FormTextField';

interface ApiKeyStepProps {
  apiKey: string;
  onApiKeyChange: (value: string) => void;
}

export function ApiKeyStep({ apiKey, onApiKeyChange }: ApiKeyStepProps) {
  return (
    <View className="gap-4">
      <FormTextField
        label="Smartlead API Key"
        value={apiKey}
        onChangeText={onApiKeyChange}
        placeholder="Enter your Smartlead API key"
        autoCapitalize="none"
        autoCorrect={false}
        variant="solid"
        hint="Find your API key in Smartlead under Settings. Your key is only used for this session and is not stored."
      />
      <View className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
        <Text className="text-amber-200 text-sm font-instrument">
          Anything you import here will be added to the account you are currently viewing. If you manage multiple
          accounts, make sure you only import the campaigns that belong to that account so they are assigned
          correctly.
        </Text>
      </View>
    </View>
  );
}
