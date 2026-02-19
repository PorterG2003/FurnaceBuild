import React from 'react';
import { View, Text, Pressable } from 'react-native';

export type AlertVariant = 'error' | 'success' | 'warning' | 'info';

interface AlertProps {
  variant?: AlertVariant;
  message: string;
  /**
   * Optional action button text
   */
  actionText?: string;
  /**
   * Optional action handler
   */
  onAction?: () => void;
  /**
   * Additional className
   */
  className?: string;
}

const variantStyles = {
  error: {
    container: 'bg-red-500/20 border-red-500/30',
    text: 'text-red-400',
    actionText: 'text-red-300',
    actionButton: 'bg-red-500/20 border border-red-500/30',
  },
  success: {
    container: 'bg-green-500/20 border-green-500/30',
    text: 'text-green-400',
    actionText: 'text-green-300',
    actionButton: 'bg-green-500/20 border border-green-500/30',
  },
  warning: {
    container: 'bg-yellow-500/20 border-yellow-500/30',
    text: 'text-yellow-400',
    actionText: 'text-yellow-300',
    actionButton: 'bg-yellow-500/20 border border-yellow-500/30',
  },
  info: {
    container: 'bg-blue-500/20 border-blue-500/30',
    text: 'text-blue-400',
    actionText: 'text-blue-300',
    actionButton: 'bg-blue-500/20 border border-blue-500/30',
  },
};

/**
 * Alert component for displaying error, success, warning, or info messages
 */
export function Alert({
  variant = 'error',
  message,
  actionText,
  onAction,
  className,
}: AlertProps) {
  const styles = variantStyles[variant];

  return (
    <View className={`mb-4 p-4 border rounded-xl ${styles.container} ${className || ''}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text className={`${styles.text} font-instrument-medium text-sm`} style={{ flex: 1 }}>
          {message}
        </Text>
        {actionText && onAction && (
          <Pressable
            onPress={onAction}
            className={`${styles.actionButton} rounded-lg`}
            style={{ paddingHorizontal: 12, paddingVertical: 6, flexShrink: 0 }}
          >
            <Text className={`${styles.actionText} font-instrument-medium text-sm`}>
              {actionText}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

