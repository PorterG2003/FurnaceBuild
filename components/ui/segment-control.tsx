import React from 'react';
import { TouchableOpacity, Text, View } from 'react-native';
import { cn } from '@/lib/cn';

export interface SegmentControlOption {
  value: string;
  label: string;
}

export interface SegmentControlProps {
  options: SegmentControlOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Unselected segment style: 'secondary' (dark bg, border) or 'outline' */
  unselectedVariant?: 'secondary' | 'outline';
}

export function SegmentControl({
  options,
  value,
  onChange,
  className,
  unselectedVariant = 'secondary',
}: SegmentControlProps) {
  return (
    <View className={cn('flex-row gap-2', className)}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.8}
            className={cn(
              'flex-1 rounded-xl px-4 py-3 items-center justify-center border',
              selected && 'bg-brand-orange border-brand-orange',
              !selected && unselectedVariant === 'secondary' && 'border-[#3A3A3A] bg-[#2A2A2A]',
              !selected && unselectedVariant === 'outline' && 'border-white/20 bg-white/5'
            )}
            style={{ borderWidth: 1 }}
          >
            <Text
              className={cn(
                'font-instrument-medium text-sm',
                selected ? 'text-white' : 'text-gray-400'
              )}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
