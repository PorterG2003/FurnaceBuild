import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { FluxHexColorField } from '@/components/flux/FluxHexColorField';
import { enrichThemeConfig } from '@/lib/flux/enrichThemeConfig';
import { FLUX_THEME_ADVANCED_COLOR_FIELDS } from '@/lib/flux/fluxBlockAppearanceFields';
import { fluxPanelHexContainerRowClass, fluxPanelLabelClass } from '@/lib/flux/fluxEditorPanelClasses';
import type { ThemeConfig } from '@/lib/flux/types';

interface FluxThemeAdvancedColorsSectionProps {
  theme: ThemeConfig;
  onPatch: (patch: Partial<ThemeConfig>) => void;
  pairFieldColumns?: boolean;
}

export function FluxThemeAdvancedColorsSection({
  theme,
  onPatch,
  pairFieldColumns = false,
}: FluxThemeAdvancedColorsSectionProps) {
  const [open, setOpen] = useState(false);
  const derived = enrichThemeConfig({
    primaryColor: theme.primaryColor,
    accentColor: theme.accentColor,
    backgroundColor: theme.backgroundColor,
    textColor: theme.textColor,
    fontFamily: theme.fontFamily,
    blockStylePreset: theme.blockStylePreset,
  });

  if (!open) {
    return (
      <Pressable className="mb-1.5" onPress={() => setOpen(true)}>
        <Text className="text-indigo-400 text-xs font-instrument-semibold">Advanced colors…</Text>
      </Pressable>
    );
  }

  return (
    <View className="border border-[#333] rounded-md p-2 bg-[#222] gap-2 mb-1.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-gray-300 text-xs font-instrument-semibold">Advanced colors</Text>
        <Pressable onPress={() => setOpen(false)} hitSlop={8}>
          <Text className="text-gray-500 text-[11px] font-instrument">Hide</Text>
        </Pressable>
      </View>
      {FLUX_THEME_ADVANCED_COLOR_FIELDS.map((field, index) => {
        if (pairFieldColumns && index % 2 === 1) return null;
        const next = pairFieldColumns ? FLUX_THEME_ADVANCED_COLOR_FIELDS[index + 1] : undefined;
        const derivedValue = derived[field.key] as string;
        return pairFieldColumns && next ? (
          <View key={field.key} className="flex-row gap-2 flex-wrap">
            <View className="flex-1 min-w-[140px]">
              <Text className={fluxPanelLabelClass}>{field.label}</Text>
              <FluxHexColorField
                value={(theme[field.key] as string | undefined) ?? derivedValue}
                onChange={(hex) => onPatch({ [field.key]: hex })}
                placeholder={field.placeholder}
                fallbackHex={field.fallbackHex}
                containerClassName={fluxPanelHexContainerRowClass}
              />
              <Pressable onPress={() => onPatch({ [field.key]: derivedValue })} className="mt-0.5">
                <Text className="text-gray-500 text-[10px] font-instrument">Reset to derived</Text>
              </Pressable>
            </View>
            <View className="flex-1 min-w-[140px]">
              <Text className={fluxPanelLabelClass}>{next.label}</Text>
              <FluxHexColorField
                value={(theme[next.key] as string | undefined) ?? (derived[next.key] as string)}
                onChange={(hex) => onPatch({ [next.key]: hex })}
                placeholder={next.placeholder}
                fallbackHex={next.fallbackHex}
                containerClassName={fluxPanelHexContainerRowClass}
              />
              <Pressable
                onPress={() => onPatch({ [next.key]: derived[next.key] as string })}
                className="mt-0.5"
              >
                <Text className="text-gray-500 text-[10px] font-instrument">Reset to derived</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          !pairFieldColumns || index % 2 === 0 ? (
            <View key={field.key}>
              <Text className={fluxPanelLabelClass}>{field.label}</Text>
              <FluxHexColorField
                value={(theme[field.key] as string | undefined) ?? derivedValue}
                onChange={(hex) => onPatch({ [field.key]: hex })}
                placeholder={field.placeholder}
                fallbackHex={field.fallbackHex}
              />
              <Pressable onPress={() => onPatch({ [field.key]: derivedValue })} className="mt-0.5 mb-1">
                <Text className="text-gray-500 text-[10px] font-instrument">Reset to derived</Text>
              </Pressable>
            </View>
          ) : null
        );
      })}
    </View>
  );
}

export function FluxPageHeaderColorsSection({
  theme,
  onPatchHeader: onPatch,
  pairFieldColumns = false,
}: {
  theme: ThemeConfig;
  onPatchHeader: (patch: NonNullable<ThemeConfig['header']>) => void;
  pairFieldColumns?: boolean;
}) {
  const derived = enrichThemeConfig(theme);
  const header = theme.header ?? {};
  const patch = (key: 'backgroundColor' | 'borderColor', value: string | undefined) => {
    const next = { ...header };
    if (value) next[key] = value;
    else delete next[key];
    onPatch(Object.keys(next).length > 0 ? next : {});
  };

  const bgField = (
    <View className={pairFieldColumns ? 'flex-1 min-w-[140px]' : 'w-full'}>
      <Text className={fluxPanelLabelClass}>Header background</Text>
      <FluxHexColorField
        value={header.backgroundColor ?? ''}
        onChange={(hex) => patch('backgroundColor', hex.trim() ? hex : undefined)}
        placeholder={derived.surfaceColor}
        fallbackHex={derived.surfaceColor}
        containerClassName={pairFieldColumns ? fluxPanelHexContainerRowClass : undefined}
      />
    </View>
  );
  const borderField = (
    <View className={pairFieldColumns ? 'flex-1 min-w-[140px]' : 'w-full'}>
      <Text className={fluxPanelLabelClass}>Header border</Text>
      <FluxHexColorField
        value={header.borderColor ?? ''}
        onChange={(hex) => patch('borderColor', hex.trim() ? hex : undefined)}
        placeholder={derived.borderColor}
        fallbackHex={derived.borderColor}
        containerClassName={pairFieldColumns ? fluxPanelHexContainerRowClass : undefined}
      />
    </View>
  );

  return (
    <View className="gap-1.5 mb-1.5">
      <Text className="text-gray-300 text-xs font-instrument-semibold">Header (logo bar)</Text>
      <Text className="text-gray-500 text-[10px] font-instrument leading-3 mb-1">
        Background and border only. The logo is an image — there is no headline text in this strip. Hero
        headlines use Block colors on the Hero block.
      </Text>
      {pairFieldColumns ? (
        <View className="flex-row gap-2 flex-wrap">
          {bgField}
          {borderField}
        </View>
      ) : (
        <>
          {bgField}
          {borderField}
        </>
      )}
      {theme.header ? (
        <Pressable onPress={() => onPatch({})}>
          <Text className="text-indigo-400 text-[11px] font-instrument-semibold">Reset header colors</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
