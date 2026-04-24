import React from 'react';
import { View, Text } from 'react-native';

export function FluxNotFound() {
  return (
    <View className="flex-1 bg-[#121212] items-center justify-center px-8">
      <Text className="text-white text-2xl font-instrument-semibold mb-2 text-center">Page not found</Text>
      <Text className="text-gray-500 text-sm font-instrument text-center max-w-sm">
        The page you are looking for does not exist or has been moved.
      </Text>
    </View>
  );
}
