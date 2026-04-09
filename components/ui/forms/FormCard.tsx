import React from 'react';
import { View } from 'react-native';

interface FormCardProps {
  children: React.ReactNode;
  className?: string;
}

export function FormCard({ children, className }: FormCardProps) {
  return (
    <View className="flex-1 justify-center px-6 py-8">
      <View className={`max-w-md w-full mx-auto ${className || ''}`}>{children}</View>
    </View>
  );
}
