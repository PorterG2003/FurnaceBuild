import React, { useMemo } from 'react';
import { EllipsisVerticalIcon, PencilSquareIcon, TrashIcon } from 'react-native-heroicons/outline';
import { RowOverflowMenu } from '@/components/ui/RowOverflowMenu';

export interface FluxRowOverflowMenuProps {
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
  /** Optional label for the bottom sheet header (mobile). */
  sheetTitle?: string;
}

export function FluxRowOverflowMenu({
  onEdit,
  onDelete,
  disabled = false,
  sheetTitle,
}: FluxRowOverflowMenuProps) {
  const items = useMemo(
    () => [
      {
        key: 'edit',
        label: 'Edit',
        onPress: onEdit,
        icon: PencilSquareIcon,
      },
      {
        key: 'delete',
        label: 'Delete',
        onPress: onDelete,
        icon: TrashIcon,
        tone: 'destructive' as const,
      },
    ],
    [onDelete, onEdit],
  );

  return (
    <RowOverflowMenu
      items={items}
      disabled={disabled}
      sheetTitle={sheetTitle}
      triggerIcon={EllipsisVerticalIcon}
      triggerAccessibilityLabel="Row actions"
      menuMinWidth={148}
      horizontalAlign="start"
    />
  );
}
