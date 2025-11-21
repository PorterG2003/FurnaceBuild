import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';

interface LoadingStateProps {
  /**
   * Loading message to display
   */
  message?: string;
  /**
   * Size of the activity indicator (default: 'large')
   */
  size?: 'small' | 'large';
  /**
   * Additional className for the container
   */
  className?: string;
  /**
   * Custom color for the activity indicator (default: brand orange)
   */
  color?: string;
}

/**
 * Loading state component with activity indicator and optional message
 */
export function LoadingState({
  message,
  size = 'large',
  className,
  color = '#f85102',
}: LoadingStateProps) {
  return (
    <View className={`items-center justify-center py-20 ${className || ''}`}>
      <ActivityIndicator size={size} color={color} />
      {message && (
        <Text className="text-gray-400 font-instrument mt-4">
          {message}
        </Text>
      )}
    </View>
  );
}

