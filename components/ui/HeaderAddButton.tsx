import React from 'react';
import { Pressable } from 'react-native';
import { PlusIcon } from 'react-native-heroicons/outline';
import { cn } from '@/lib/cn';

const ICON_COLOR = '#f85102';

export interface HeaderAddButtonProps {
  onPress: () => void;
  /** Accessibility label (e.g. "New campaign") */
  accessibilityLabel?: string;
  /** Icon size in px (default 22) */
  iconSize?: number;
  /** Optional className for the Pressable (e.g. size override) */
  className?: string;
}

/**
 * Small square header button with plus icon, styled like the active tab on the
 * desktop nav (subtle orange tint, orange border). Use in page headers for
 * "add" / "new" actions (e.g. New Campaign, New Sender).
 */
export function HeaderAddButton({
  onPress,
  accessibilityLabel = 'Add',
  iconSize = 22,
  className,
}: HeaderAddButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className={cn(
        'w-12 h-12 rounded-lg items-center justify-center bg-[rgba(243,68,13,0.15)]',
        className
      )}
    >
      <PlusIcon size={iconSize} color={ICON_COLOR} />
    </Pressable>
  );
}
