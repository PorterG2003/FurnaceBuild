import React from 'react';
import { ChevronDownIcon, ChevronRightIcon } from 'react-native-heroicons/outline';
import { Platform, Pressable, Text, View } from 'react-native';

export function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View
      className="border-b border-[#252525] pb-2"
      style={{
        alignSelf: 'stretch',
        ...(Platform.OS === 'web' ? { userSelect: 'none' as const } : {}),
      }}
    >
      <Pressable
        onPress={onToggle}
        className="flex-row items-center justify-between py-1.5"
        style={{
          minWidth: 0,
          ...(Platform.OS === 'web' ? { userSelect: 'none' as const } : {}),
        }}
      >
        <Text selectable={false} className="text-gray-300 font-instrument-semibold text-xs uppercase tracking-wider">
          {title}
        </Text>
        {open ? <ChevronDownIcon size={14} color="#9ca3af" /> : <ChevronRightIcon size={14} color="#9ca3af" />}
      </Pressable>
      {open ? (
        <View
          className="gap-2 pt-1"
          style={{
            alignSelf: 'stretch',
            ...(Platform.OS === 'web' ? { userSelect: 'none' as const } : {}),
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}
