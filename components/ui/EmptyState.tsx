import React from 'react';
import { View, Text } from 'react-native';
import { Button } from './button';

interface EmptyStateProps {
  /**
   * Title text
   */
  title: string;
  /**
   * Description/subtitle text
   */
  description?: string;
  /**
   * Optional action button text
   */
  actionText?: string;
  /**
   * Optional action handler
   */
  onAction?: () => void;
  /**
   * Optional custom content to render instead of default button
   */
  action?: React.ReactNode;
  /**
   * Additional className for the container
   */
  className?: string;
}

/**
 * Empty state component for displaying when lists are empty
 */
export function EmptyState({
  title,
  description,
  actionText,
  onAction,
  action,
  className,
}: EmptyStateProps) {
  return (
    <View className={`items-center justify-center py-20 ${className || ''}`}>
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-8 max-w-md w-full items-center">
        <Text className="text-white font-instrument-semibold text-xl mb-2">
          {title}
        </Text>
        {description && (
          <Text className="text-gray-400 font-instrument text-center mb-6">
            {description}
          </Text>
        )}
        {action || (actionText && onAction && (
          <Button onPress={onAction}>
            {actionText}
          </Button>
        ))}
      </View>
    </View>
  );
}

