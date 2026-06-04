import React from 'react';
import { Text, View } from 'react-native';
import { authLabelClassName } from '@/components/auth/authFormStyles';

export function FormFieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-4">
      <Text className={authLabelClassName}>{label}</Text>
      {children}
    </View>
  );
}

/** @deprecated Use FormFieldGroup */
export const AdminField = FormFieldGroup;
