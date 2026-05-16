import React from 'react';
import { Platform, Text, Pressable, ScrollView } from 'react-native';
import { FLUX_GOOGLE_FONT_NAMES } from '@/lib/flux/googleFontsCatalog';

export function FluxFontFamilyPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (font: string) => void;
}) {
  const current = value?.trim() || 'Inter';

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled={Platform.OS === 'android'}
      showsHorizontalScrollIndicator
      className="mb-1.5"
      contentContainerStyle={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 4,
        paddingRight: 8,
      }}
    >
      {FLUX_GOOGLE_FONT_NAMES.map((f) => {
        const selected = current === f;
        return (
          <Pressable
            key={f}
            onPress={() => onChange(f)}
            style={{ flexShrink: 0 }}
            className={
              selected ? 'px-3 py-1.5 rounded-lg border border-indigo-500 bg-indigo-500/20' : 'px-2.5 py-1.5 rounded-lg'
            }
          >
            <Text className="text-white text-xs leading-5" style={{ fontFamily: f }}>
              {f}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
