import type { ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDownIcon } from 'react-native-heroicons/outline';
import {
  getMessageToolbarToneColors,
  type MessageToolbarActionTone,
} from './messageToolbarStyles';

export type MessageToolbarMenuIcon = ComponentType<{ size?: number; color?: string }>;

export interface MessageToolbarActionButtonProps {
  label: string;
  icon?: MessageToolbarMenuIcon;
  onPress: () => void;
  tone?: MessageToolbarActionTone;
  accessibilityLabel?: string;
  trailingChevron?: boolean;
  compactLabelColor?: string;
  maxWidth?: number;
}
export function MessageToolbarActionButton({
  label,
  icon: Icon,
  onPress,
  tone = 'default',
  accessibilityLabel,
  trailingChevron = false,
  compactLabelColor,
  maxWidth,
}: MessageToolbarActionButtonProps) {
  const styles = getMessageToolbarToneColors(tone);
  const textColor = compactLabelColor ?? styles.textColor;
  const sharedStyle = {
    backgroundColor: styles.backgroundColor,
    borderWidth: 1,
    borderColor: styles.borderColor,
    maxWidth,
  };
  const content = (
    <>
      {Icon ? <Icon size={14} color={styles.iconColor} /> : null}
      <View className="flex-row items-center min-w-0 flex-1">
        <Text className="text-xs font-instrument-medium" numberOfLines={1} style={{ color: textColor }}>
          {label}
        </Text>
        {trailingChevron ? <ChevronDownIcon size={14} color="#9CA3AF" style={{ marginLeft: 10 }} /> : null}
      </View>
    </>
  );

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 min-h-[32px] shrink-0"
      style={sharedStyle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {content}
    </Pressable>
  );
}
