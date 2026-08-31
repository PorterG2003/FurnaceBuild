import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  PauseIcon,
  PlayIcon,
  StopIcon,
} from 'react-native-heroicons/outline';
import { BottomSheet } from '@/components/ui/modals';
import { CampaignStopConfirmModal } from './CampaignStopConfirmModal';
import type { CampaignStatusMenuStatus } from './CampaignStatusMenu';

interface StatusActionItem {
  key: string;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'destructive';
  icon: React.ComponentType<{ size?: number; color?: string }>;
}

export interface CampaignStatusActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  status: CampaignStatusMenuStatus;
  campaignName?: string;
  isPausing?: boolean;
  isStarting?: boolean;
  isStopping?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}

const sheetRowClassName = 'flex-row items-center gap-3 py-3';

export function CampaignStatusActionsSheet({
  visible,
  onClose,
  status,
  campaignName,
  isPausing = false,
  isStarting = false,
  isStopping = false,
  onPause,
  onResume,
  onStop,
}: CampaignStatusActionsSheetProps) {
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const busy = isPausing || isStarting || isStopping;

  const closeStopConfirm = useCallback(() => setStopConfirmOpen(false), []);

  const openStopConfirm = useCallback(() => {
    onClose();
    setStopConfirmOpen(true);
  }, [onClose]);

  const handleConfirmStop = useCallback(async () => {
    await onStop?.();
    setStopConfirmOpen(false);
  }, [onStop]);

  const handlePauseInstead = useCallback(async () => {
    await onPause?.();
    setStopConfirmOpen(false);
  }, [onPause]);

  const items = useMemo((): StatusActionItem[] => {
    if (status === 'running') {
      return [
        {
          key: 'pause',
          label: isPausing ? 'Pausing...' : 'Pause campaign',
          onPress: onPause,
          disabled: busy || !onPause,
          icon: PauseIcon,
        },
        {
          key: 'stop',
          label: isStopping ? 'Stopping...' : 'Stop campaign',
          onPress: openStopConfirm,
          disabled: busy,
          tone: 'destructive',
          icon: StopIcon,
        },
      ];
    }
    if (status === 'scheduled') {
      return [
        {
          key: 'stop',
          label: isStopping ? 'Stopping...' : 'Stop campaign',
          onPress: openStopConfirm,
          disabled: busy,
          tone: 'destructive',
          icon: StopIcon,
        },
      ];
    }
    if (status === 'paused') {
      return [
        {
          key: 'resume',
          label: isStarting ? 'Resuming...' : 'Resume campaign',
          onPress: onResume,
          disabled: busy || !onResume,
          icon: PlayIcon,
        },
        {
          key: 'stop',
          label: isStopping ? 'Stopping...' : 'Stop campaign',
          onPress: openStopConfirm,
          disabled: busy,
          tone: 'destructive',
          icon: StopIcon,
        },
      ];
    }
    return [];
  }, [busy, isPausing, isStarting, isStopping, onPause, onResume, openStopConfirm, status]);

  const handleItemPress = useCallback(
    (item: StatusActionItem) => {
      if (item.disabled || !item.onPress) return;
      onClose();
      item.onPress();
    },
    [onClose],
  );

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose}>
        <View className="border-b border-[#2A2A2A] pb-3 mb-1">
          <Text className="text-white font-instrument-semibold text-base">Campaign status</Text>
        </View>
        <View className="gap-1">
          {items.map((item) => {
            const color = item.tone === 'destructive' ? '#f87171' : '#9CA3AF';
            const textClassName =
              item.tone === 'destructive'
                ? 'text-red-400 font-instrument-medium text-base'
                : 'text-white font-instrument-medium text-base';
            const Icon = item.icon;
            return (
              <Pressable
                key={item.key}
                onPress={() => handleItemPress(item)}
                disabled={item.disabled}
                className={`${sheetRowClassName} ${item.disabled ? 'opacity-50' : ''}`}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                <Icon size={20} color={color} />
                <Text className={textClassName}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>

      <CampaignStopConfirmModal
        visible={stopConfirmOpen}
        onClose={closeStopConfirm}
        onConfirmStop={handleConfirmStop}
        onPauseInstead={status === 'running' ? handlePauseInstead : undefined}
        campaignName={campaignName}
        isLoading={isStopping}
        isPausing={isPausing}
      />
    </>
  );
}
