import { View, Text, TextInput, Pressable } from 'react-native';
import { TrashIcon } from 'react-native-heroicons/outline';
import { TAG_PRESET_COLORS } from '@/lib/tags/tag-colors';

export interface EditTagFormProps {
  entityLabel: string;
  name: string;
  onNameChange: (value: string) => void;
  selectedColor: string;
  onColorChange: (color: string) => void;
  onDeletePress: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function EditTagForm({
  entityLabel,
  name,
  onNameChange,
  selectedColor,
  onColorChange,
  onDeletePress,
  disabled = false,
  autoFocus = false,
}: EditTagFormProps) {
  return (
    <View className="gap-4">
      <View>
        <View className="flex-row justify-between items-center mb-2">
          <View className="flex-1 mr-3">
            <Text className="text-base font-instrument-medium text-white">Tag name</Text>
            <Text className="text-sm font-instrument text-gray-400 mt-0.5">
              This will appear on {entityLabel} and in filters.
            </Text>
          </View>
          <Pressable
            onPress={onDeletePress}
            disabled={disabled}
            className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/20 border border-red-500/30"
            style={{ opacity: disabled ? 0.5 : 1 }}
          >
            <TrashIcon size={16} color="#F87171" />
            <Text className="text-sm font-instrument-medium text-red-400">Delete tag</Text>
          </Pressable>
        </View>
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
