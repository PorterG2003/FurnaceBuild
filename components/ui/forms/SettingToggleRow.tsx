import { Text, View } from 'react-native';
import { Toggle } from '@/components/ui/Toggle';

type SettingToggleRowProps = {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
};

export function SettingToggleRow({
  label,
  description,
  value,
  onValueChange,
}: SettingToggleRowProps) {
  return (
    <View className="flex-row items-center justify-between gap-3 rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
      <View className="flex-1">
        <Text className="text-white font-instrument-medium">{label}</Text>
        {description ? (
          <Text className="text-gray-400 font-instrument text-sm mt-1">{description}</Text>
        ) : null}
      </View>
      <Toggle value={value} onValueChange={onValueChange} />
    </View>
  );
}
