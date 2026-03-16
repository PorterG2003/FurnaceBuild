import { useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';

interface DataSenderNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    label?: string;
    endpoint?: string;
    payload?: string;
  }) => void;
  initialData?: {
    label?: string;
    endpoint?: string;
    payload?: string;
  };
}

function DataSenderNodeModal({
  visible,
  onClose,
  onSave,
  initialData,
}: DataSenderNodeModalProps) {
  const [label, setLabel] = useState(initialData?.label || 'Data Sender');
  const [endpoint, setEndpoint] = useState(initialData?.endpoint || '');
  const [payload, setPayload] = useState(initialData?.payload || '');

  const handleSave = () => {
    onSave({ label, endpoint, payload });
    onClose();
  };

  const footer = (
    <View className="flex-row gap-3">
      <View className="flex-1">
        <Button variant="secondary" onPress={onClose} className="flex-1">
          Cancel
        </Button>
      </View>
      <View className="flex-1">
        <Button onPress={handleSave}>
          Save
        </Button>
      </View>
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Configure Data Sender Node"
      description="Configure the endpoint and payload"
      footer={footer}
    >
      <View className="gap-4">
        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Label
          </Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Node label"
            placeholderTextColor="#666"
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
            style={{
              borderColor: '#FFFFFF4D',
              backgroundColor: '#FFFFFF0D',
              color: '#FFFFFF',
              borderWidth: 1,
            }}
            selectionColor="#FF4D00"
            underlineColorAndroid="transparent"
          />
        </View>

        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Endpoint URL
          </Text>
          <TextInput
            value={endpoint}
            onChangeText={setEndpoint}
            placeholder="https://api.example.com/webhook"
            placeholderTextColor="#666"
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
            style={{
              borderColor: '#FFFFFF4D',
              backgroundColor: '#FFFFFF0D',
              color: '#FFFFFF',
              borderWidth: 1,
            }}
            selectionColor="#FF4D00"
            underlineColorAndroid="transparent"
            autoCapitalize="none"
            keyboardType="url"
          />
        </View>

        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Payload (JSON)
          </Text>
          <TextInput
            value={payload}
            onChangeText={setPayload}
            placeholder='{"key": "value"}'
            placeholderTextColor="#666"
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
            style={{
              borderColor: '#FFFFFF4D',
              backgroundColor: '#FFFFFF0D',
              color: '#FFFFFF',
              borderWidth: 1,
              minHeight: 100,
            }}
            selectionColor="#FF4D00"
            underlineColorAndroid="transparent"
            multiline
            textAlignVertical="top"
          />
        </View>
      </View>
    </BaseModal>
  );
}

export { DataSenderNodeModal };
export default DataSenderNodeModal;

