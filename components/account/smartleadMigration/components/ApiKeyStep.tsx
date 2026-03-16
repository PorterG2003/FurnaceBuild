import { Text, TextInput, View } from 'react-native';

interface ApiKeyStepProps {
  apiKey: string;
  onApiKeyChange: (value: string) => void;
}

export function ApiKeyStep({ apiKey, onApiKeyChange }: ApiKeyStepProps) {
  return (
    <View className="gap-4">
      <View>
        <Text className="text-xs text-gray-400 font-instrument-medium mb-2">Smartlead API Key</Text>
        <TextInput
          value={apiKey}
          onChangeText={onApiKeyChange}
          placeholder="Enter your Smartlead API key"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          className="border rounded-lg px-3 py-2.5 bg-[#121212] text-sm text-white"
          style={{
            borderColor: '#3A3A3A',
            backgroundColor: '#121212',
            color: '#FFFFFF',
            borderWidth: 1,
          }}
        />
        <Text className="text-xs text-gray-500 mt-2">
          Find your API key in Smartlead under Settings. Your key is only used for this session and is not stored.
        </Text>
        <View className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <Text className="text-amber-200 text-sm font-instrument">
            Anything you import here will be added to the account you are currently viewing. If you manage multiple
            accounts, make sure you only import the campaigns that belong to that account so they are assigned
            correctly.
          </Text>
        </View>
      </View>
    </View>
  );
}
