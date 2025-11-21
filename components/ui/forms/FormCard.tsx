import React from 'react';
import { View } from 'react-native';
import { Logo } from '../branding';

interface FormCardProps {
  children: React.ReactNode;
  className?: string;
}

export function FormCard({ children, className }: FormCardProps) {
  return (
    <View className="flex-1 justify-center px-6">
      <Logo />
      <View className={`max-w-md w-full mx-auto bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 p-8 ${className || ''}`}>
        {children}
      </View>
    </View>
  );
}
