import type { ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDownIcon } from 'react-native-heroicons/outline';
import {
  OPEN_CONVERSATION_ACTION_BG,
  OPEN_CONVERSATION_ACTION_BORDER,
  OPEN_CONVERSATION_ACTION_TEXT,
  OPEN_CONVERSATION_COLOR,
} from './inboxConstants';

export type MessageToolbarMenuIcon = ComponentType<{ size?: number; color?: string }>;

export type MessageToolbarActionTone = 'default' | 'destructive' | 'open' | 'ooo' | 'replace';

export interface MessageToolbarActionButtonProps {
  label: string;
  icon?: MessageToolbarMenuIcon;
  onPress: () => void;
  tone?: MessageToolbarActionTone;
  accessibilityLabel?: string;
  trailingChevron?: boolean;
  compactLabelColor?: string;
  measureOnly?: boolean;
}

const TONE_STYLES: Record<
  MessageToolbarActionTone,
  {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    iconColor: string;
  }
> = {
  default: {
    backgroundColor: '#FFFFFF0D',
    borderColor: '#FFFFFF4D',
    textColor: '#FFFFFF',
    iconColor: '#9CA3AF',
  },
  destructive: {
    backgroundColor: 'rgba(185, 28, 28, 0.15)',
    borderColor: 'rgba(185, 28, 28, 0.5)',
    textColor: '#FCA5A5',
    iconColor: '#F87171',
  },
  open: {
    backgroundColor: OPEN_CONVERSATION_ACTION_BG,
    borderColor: OPEN_CONVERSATION_ACTION_BORDER,
    textColor: OPEN_CONVERSATION_ACTION_TEXT,
    iconColor: OPEN_CONVERSATION_COLOR,
  },
  ooo: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderColor: 'rgba(59, 130, 246, 0.45)',
    textColor: '#BFDBFE',
    iconColor: '#93C5FD',
  },
  replace: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: 'rgba(249, 115, 22, 0.4)',
    textColor: '#FDBA74',
    iconColor: '#FDBA74',
  },
};

export function getMessageToolbarToneColors(tone: MessageToolbarActionTone = 'default') {
  return TONE_STYLES[tone];
}

export function MessageToolbarActionButton({
  label,
  icon: Icon,
  onPress,
  tone = 'default',
  accessibilityLabel,
  trailingChevron = false,
  compactLabelColor,
  measureOnly = false,
}: MessageToolbarActionButtonProps) {
  const styles = TONE_STYLES[tone];
  const textColor = compactLabelColor ?? styles.textColor;
  const content = (
    <>
      {Icon ? <Icon size={14} color={styles.iconColor} /> : null}
      <View className="flex-row items-center min-w-0">
        <Text className="text-xs font-instrument-medium" numberOfLines={1} style={{ color: textColor }}>
          {label}
        </Text>
        {trailingChevron ? <ChevronDownIcon size={14} color="#9CA3AF" style={{ marginLeft: 10 }} /> : null}
      </View>
    </>
  );

  if (measureOnly) {
    return (
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
        className="flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 min-h-[32px] shrink-0"
        style={{
          backgroundColor: styles.backgroundColor,
          borderWidth: 1,
          borderColor: styles.borderColor,
        }}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 min-h-[32px] shrink-0"
      style={{
        backgroundColor: styles.backgroundColor,
        borderWidth: 1,
        borderColor: styles.borderColor,
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {content}
    </Pressable>
  );
}
