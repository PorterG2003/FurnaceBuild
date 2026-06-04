import { Text, View } from 'react-native';

export type PlatformPaymentBreakdownRow = {
  label: string;
  value: string;
  emphasize?: boolean;
};

export type PlatformPaymentBreakdownSection = {
  title: string;
  rows: PlatformPaymentBreakdownRow[];
};

export function PlatformPaymentBreakdown({
  sections,
}: {
  sections: PlatformPaymentBreakdownSection[];
}) {
  return (
    <View className="gap-5">
      {sections.map((section) => (
        <View key={section.title} className="gap-3">
          <Text
            selectable={false}
            className="text-xs font-instrument-medium uppercase tracking-[2px] text-gray-500"
          >
            {section.title}
          </Text>
          {section.rows.map((row) => (
            <View
              key={`${section.title}-${row.label}`}
              className="flex-row items-center justify-between gap-4"
            >
              <Text
                selectable={false}
                className={`font-instrument ${
                  row.emphasize ? 'text-white text-base font-instrument-semibold' : 'text-gray-300'
                }`}
              >
                {row.label}
              </Text>
              <Text
                selectable={false}
                className={`font-instrument ${
                  row.emphasize ? 'text-white text-lg font-instrument-semibold' : 'text-gray-300'
                }`}
              >
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
