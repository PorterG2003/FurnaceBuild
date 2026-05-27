import { Text, View } from 'react-native';
import { FormFieldHelpIcon } from '@/components/ui/forms';

export function WorkbenchBulkMetricRow({
  label,
  value,
  help,
}: {
  label: string;
  value: number | boolean;
  help?: string;
}) {
  const displayValue = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value;

  return (
    <View className="flex-row items-center justify-between border border-[#2A2A2A] rounded-xl px-3 py-3 bg-[#181818]">
      <View className="flex-row items-center gap-1.5 flex-1 min-w-0 pr-3">
        <Text className="text-gray-400 font-instrument text-sm">{label}</Text>
        {help ? (
          <FormFieldHelpIcon content={help} accessibilityLabel={`Help for ${label}`} />
        ) : null}
      </View>
      <Text className="text-white font-instrument-semibold text-base">{displayValue}</Text>
    </View>
  );
}

export function WorkbenchBulkMetricsGrid({ children }: { children: React.ReactNode }) {
  return <View className="gap-2">{children}</View>;
}
