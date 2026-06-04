import { type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDownIcon, ChevronRightIcon } from 'react-native-heroicons/outline';

type Props = {
  title: string;
  summary?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export function AdminCollapsibleCard({ title, summary, expanded, onToggle, children }: Props) {
  return (
    <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
      <Pressable
        onPress={onToggle}
        className="flex-row items-center justify-between gap-4"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View className="flex-1 min-w-0">
          <Text className="text-white text-xl font-instrument-semibold">{title}</Text>
        </View>
        {summary != null ? (
          <View className="items-end shrink-0">{summary}</View>
        ) : null}
        <View className="shrink-0">
          {expanded ? (
            <ChevronDownIcon size={20} color="#9CA3AF" />
          ) : (
            <ChevronRightIcon size={20} color="#9CA3AF" />
          )}
        </View>
      </Pressable>
      {expanded ? <View className="mt-5">{children}</View> : null}
    </View>
  );
}

function DetailField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={`flex-1 min-w-[140px] ${className ?? ''}`}>
      <Text className="text-gray-500 font-instrument text-xs mb-1">{label}</Text>
      {children}
    </View>
  );
}

export function AdminDetailFieldGrid({
  fields,
  isMobile,
}: {
  fields: Array<{ key: string; label: string; value: ReactNode }>;
  isMobile: boolean;
}) {
  return (
    <View className={isMobile ? 'flex-col gap-4' : 'flex-row flex-wrap gap-x-8 gap-y-4'}>
      {fields.map((field) => (
        <DetailField key={field.key} label={field.label}>
          {field.value}
        </DetailField>
      ))}
    </View>
  );
}
