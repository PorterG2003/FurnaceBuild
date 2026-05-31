import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

type Props = {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (nextValue: number) => void;
  formatValue?: (value: number) => string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snap(value: number, step: number): number {
  const factor = step >= 1 ? 1 : Math.round(1 / step);
  return factor === 1 ? Math.round(value) : Math.round(value * factor) / factor;
}

export function PreviewRangeControl({
  value,
  min,
  max,
  step,
  onChange,
  formatValue = (nextValue) => String(nextValue),
}: Props) {
  const commit = (nextValue: number) => {
    onChange(snap(clamp(nextValue, min, max), step));
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => commit(value - step)}
          className="h-9 w-9 items-center justify-center rounded-lg border border-[#2A2A2A] bg-[#121212]"
        >
          <Text className="text-white text-lg font-instrument-medium">-</Text>
        </Pressable>
        {Platform.OS === 'web'
          ? React.createElement('input', {
              type: 'range',
              min,
              max,
              step,
              value,
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                commit(Number(event.target.value));
              },
              style: {
                flex: 1,
                accentColor: '#f85102',
                cursor: 'pointer',
              },
            } as React.InputHTMLAttributes<HTMLInputElement>)
          : <View className="flex-1 h-1 rounded-full bg-[#2A2A2A]" />}
        <Pressable
          onPress={() => commit(value + step)}
          className="h-9 w-9 items-center justify-center rounded-lg border border-[#2A2A2A] bg-[#121212]"
        >
          <Text className="text-white text-lg font-instrument-medium">+</Text>
        </Pressable>
      </View>
      <Text className="text-sm text-gray-400 font-instrument">{formatValue(value)}</Text>
    </View>
  );
}
