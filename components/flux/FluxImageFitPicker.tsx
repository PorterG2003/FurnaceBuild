import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { FluxImageFit } from '@/lib/flux/types';
import { fluxPanelLabelClass } from '@/lib/flux/fluxEditorPanelClasses';

interface FluxImageFitPickerProps {
  label?: string;
  value?: FluxImageFit;
  defaultValue: FluxImageFit;
  onChange: (value: FluxImageFit) => void;
}

const OPTIONS: Array<{ id: FluxImageFit; label: string }> = [
  { id: 'cover', label: 'Fill' },
  { id: 'contain', label: 'Fit' },
];

export function FluxImageFitPicker({
  label = 'Image fit',
  value,
  defaultValue,
  onChange,
}: FluxImageFitPickerProps) {
  const resolved = value ?? defaultValue;

  return (
    <View className="gap-1 mb-1.5">
      <Text className={fluxPanelLabelClass}>{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {OPTIONS.map((option) => {
          const selected = resolved === option.id;
          return (
            <Pressable
              key={option.id}
              className={`px-2 py-1 rounded-lg border min-h-[32px] justify-center ${
                selected
                  ? 'border-indigo-500 bg-indigo-500/20'
                  : 'border-[#444] bg-[#333]'
              }`}
              onPress={() => onChange(option.id)}
            >
              <Text className="text-white text-xs">{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
