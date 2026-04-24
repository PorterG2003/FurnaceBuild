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
      className="mb-2"
      contentContainerStyle={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 6,
        paddingRight: 12,
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
              selected ? 'px-5 py-3 rounded-xl border border-indigo-500 bg-indigo-500/20' : 'px-4 py-3'
            }
          >
            <Text className="text-white text-lg leading-7" style={{ fontFamily: f }}>
              {f}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
