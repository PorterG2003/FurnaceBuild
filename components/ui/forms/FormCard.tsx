import React from 'react';
import { useWindowDimensions, View } from 'react-native';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';

interface FormCardProps {
  children: React.ReactNode;
  className?: string;
}

export function FormCard({ children, className }: FormCardProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= LAYOUT_BREAKPOINT;

  return (
    <View
      className={isWide ? 'flex-1 justify-center px-6 py-8' : 'px-5 py-6'}
    >
      <View className={`mx-auto w-full max-w-md ${className || ''}`}>{children}</View>
    </View>
  );
}
