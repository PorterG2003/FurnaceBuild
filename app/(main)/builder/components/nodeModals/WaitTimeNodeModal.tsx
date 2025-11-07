import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { BaseModal } from '@/components/ui/BaseModal';
import { Button } from '@/components/ui/button';

interface WaitTimeNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    label?: string;
    duration?: string;
    unit?: 'minutes' | 'hours' | 'days';
  }) => void;
  initialData?: {
    label?: string;
    duration?: string;
    unit?: 'minutes' | 'hours' | 'days';
  };
}

function WaitTimeNodeModal({
  visible,
  onClose,
  onSave,
  initialData,
}: WaitTimeNodeModalProps) {
  const [label, setLabel] = useState(initialData?.label || 'Wait Time');
  const [duration, setDuration] = useState(initialData?.duration || '');
  const [unit, setUnit] = useState<'minutes' | 'hours' | 'days'>(
    initialData?.unit || 'hours'
  );

  const handleSave = () => {
    onSave({ label, duration, unit });
    onClose();
  };

  const footer = (
    <View className="flex-row gap-3">
      <View className="flex-1">
        <TouchableOpacity
          onPress={onClose}
          className="border border-[#3A3A3A] rounded-xl px-6 py-3 items-center justify-center"
          style={{
            borderWidth: 1,
            borderColor: '#3A3A3A',
          }}
        >
          <Text className="text-white font-instrument-medium text-base">
            Cancel
          </Text>
        </TouchableOpacity>
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
      title="Configure Wait Time Node"
      description="Configure the wait duration"
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

        <View className="flex-row gap-3">
          <View className="flex-1">
            <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
              Duration
            </Text>
            <TextInput
              value={duration}
              onChangeText={setDuration}
              placeholder="24"
              placeholderTextColor="#666"
              keyboardType="numeric"
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

          <View className="flex-1">
            <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
              Unit
            </Text>
            <View className="flex-row gap-2">
              {(['minutes', 'hours', 'days'] as const).map((u) => (
                <TouchableOpacity
                  key={u}
                  onPress={() => setUnit(u)}
                  className={`flex-1 rounded-xl px-4 py-3 items-center justify-center border ${
                    unit === u
                      ? 'bg-brand-orange border-brand-orange'
                      : 'border-[#3A3A3A] bg-[#2A2A2A]'
                  }`}
                  style={{
                    borderWidth: 1,
                  }}
                >
                  <Text
                    className={`font-instrument-medium text-sm ${
                      unit === u ? 'text-white' : 'text-gray-400'
                    }`}
                    style={{
                      textTransform: 'capitalize',
                    }}
                  >
                    {u}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </View>
    </BaseModal>
  );
}

export { WaitTimeNodeModal };
export default WaitTimeNodeModal;

