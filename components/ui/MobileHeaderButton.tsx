import React from 'react';
import { Pressable } from 'react-native';
import { PlusIcon, EllipsisVerticalIcon } from 'react-native-heroicons/outline';
import { cn } from '@/lib/cn';

const ICON_COLOR = '#f85102';

export type MobileHeaderButtonVariant = 'add' | 'actions';

export interface MobileHeaderButtonProps {
  variant: MobileHeaderButtonVariant;
  onPress: () => void;
  /** Accessibility label (e.g. "New campaign" or "Campaign actions") */
  accessibilityLabel?: string;
  /** Icon size in px (default 22) */
  iconSize?: number;
  /** Optional className for the Pressable (e.g. size override) */
  className?: string;
}

const defaultLabels: Record<MobileHeaderButtonVariant, string> = {
  add: 'Add',
  actions: 'Actions',
};

/**
 * Small square header button for mobile, styled with subtle orange tint and
 * orange icon. Use in page headers for "add" (plus) or "actions" (three dots).
 */
export function MobileHeaderButton({
  variant,
  onPress,
  accessibilityLabel,
  iconSize = 22,
  className,
}: MobileHeaderButtonProps) {
  const label = accessibilityLabel ?? defaultLabels[variant];
  const Icon = variant === 'add' ? PlusIcon : EllipsisVerticalIcon;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(
        'w-12 h-12 rounded-lg items-center justify-center bg-[rgba(243,68,13,0.15)]',
        className
      )}
    >
      <Icon size={iconSize} color={ICON_COLOR} />
    </Pressable>
  );
}
