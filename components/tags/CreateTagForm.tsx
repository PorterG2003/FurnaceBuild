import { View, Text, TextInput, Pressable } from 'react-native';
import { TAG_PRESET_COLORS } from '@/lib/tags/tag-colors';

export interface CreateTagFormProps {
  entityLabel: string;
  name: string;
  onNameChange: (value: string) => void;
  selectedColor: string;
  onColorChange: (color: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function CreateTagForm({
  entityLabel,
  name,
  onNameChange,
  selectedColor,
  onColorChange,
  disabled = false,
  autoFocus = false,
}: CreateTagFormProps) {
  return (
    <View className="gap-4">
      <View>
        <Text className="text-base font-instrument-medium text-white mb-1">Tag name</Text>
        <Text className="text-sm font-instrument text-gray-400 mb-2">
          This will appear on {entityLabel} and in filters.
        </Text>
        <TextInput
          value={name}
          onChangeText={onNameChange}
          placeholder="e.g. Follow up"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          className="border border-white/30 rounded-xl px-4 py-3.5 bg-white/5 text-base text-white"
          style={{
            borderColor: '#FFFFFF4D',
            backgroundColor: '#FFFFFF0D',
            color: '#FFFFFF',
            borderWidth: 1,
          }}
          selectionColor="#FF4D00"
          underlineColorAndroid="transparent"
          editable={!disabled}
        />
      </View>

      <View>
        <Text className="text-base font-instrument-medium text-white mb-2">Color</Text>
        <View className="flex-row flex-wrap gap-2">
          {TAG_PRESET_COLORS.map((hex) => {
            const isSelected = selectedColor === hex;
            return (
              <Pressable
                key={hex}
                onPress={() => onColorChange(hex)}
                disabled={disabled}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: hex,
                  borderWidth: isSelected ? 3 : 1,
                  borderColor: isSelected ? '#FFFFFF' : 'rgba(255,255,255,0.2)',
                }}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}
