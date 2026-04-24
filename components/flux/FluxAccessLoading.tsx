import React from 'react';
import { ActivityIndicator, View } from 'react-native';

export function FluxAccessLoading() {
  return (
    <View className="flex-1 bg-[#121212] items-center justify-center">
      <ActivityIndicator size="large" color="#6b7280" />
    </View>
  );
}
