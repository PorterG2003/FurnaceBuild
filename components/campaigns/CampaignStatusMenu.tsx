import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  ChevronDownIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from 'react-native-heroicons/outline';
import { BottomSheet } from '@/components/ui/modals';
import { PopupPortal } from '@/components/ui/PopupPortal';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { usePickerInsideBottomSheet } from '@/components/ui/modals/PickerInsideBottomSheetContext';
import { getFormDropdownPanelStyle } from '@/components/ui/forms/formDropdownPopup';
import { CampaignStopConfirmModal } from './CampaignStopConfirmModal';

export type CampaignStatusMenuStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'stopped';

export const STATUS_TRIGGER_THEME: Record<
  CampaignStatusMenuStatus,
  { backgroundColor: string; borderColor: string; textColor: string; label: string }
> = {
  draft: {
    backgroundColor: '#37415125',
    borderColor: '#9CA3AF35',
    textColor: '#9CA3AF',
    label: 'Draft',
  },
  scheduled: {
    backgroundColor: '#1E3A8A25',
    borderColor: '#60A5FA35',
    textColor: '#60A5FA',
    label: 'Scheduled',
  },
  running: {
    backgroundColor: '#065F4625',
    borderColor: '#10B98135',
    textColor: '#10B981',
    label: 'Running',
  },
  paused: {
    backgroundColor: '#78350F25',
    borderColor: '#F59E0B35',
    textColor: '#F59E0B',
    label: 'Paused',
  },
  stopped: {
    backgroundColor: '#8B2E1F25',
    borderColor: '#EF554035',
    textColor: '#EF5540',
    label: 'Stopped',
  },
};

export function getCampaignStatusDialColor(status: CampaignStatusMenuStatus): string {
  if (status === 'stopped') return '#555555';
  return STATUS_TRIGGER_THEME[status].textColor;
}

interface MenuItem {
  key: string;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'destructive';
  icon: React.ComponentType<{ size?: number; color?: string }>;
}

export interface CampaignStatusMenuProps {
  status: CampaignStatusMenuStatus;
  campaignName?: string;
  /** When true, status is display-only (no pause/stop/resume menu). */
  readOnly?: boolean;
  isPausing?: boolean;
  isStarting?: boolean;
  isStopping?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  /**
   * When inside a parent BottomSheet on mobile, open a sibling status actions sheet
   * (reply/forward pattern) instead of drilling with takeover or nested sheets.
   */
  onOpenMobileActionsSheet?: () => void;
}

const desktopRowClassName =
  'flex-row items-center gap-2 rounded-md px-2 py-2 web:transition-colors web:duration-150 web:hover:bg-white/10 web:active:bg-white/5';

const sheetRowClassName = 'flex-row items-center gap-3 rounded-md py-3';

const sheetRowBorder = {
  borderBottomWidth: 1,
  borderBottomColor: '#2A2A2A',
};

export function CampaignStatusSheetTriggerRow({
  status,
  hasActions,
  busy,
  onPress,
}: {
  status: CampaignStatusMenuStatus;
  hasActions: boolean;
  busy?: boolean;
  onPress?: () => void;
}) {
  const theme = STATUS_TRIGGER_THEME[status];

  if (!hasActions) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 14,
          ...sheetRowBorder,
        }}
      >
        <Text className="font-instrument-medium text-base" style={{ color: theme.textColor }}>
          {theme.label}
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 14,
        opacity: busy ? 0.6 : 1,
        ...sheetRowBorder,
      }}
      accessibilityRole="button"
      accessibilityLabel={`Campaign status: ${status}. Open actions.`}
    >
      <Text className="font-instrument-medium text-base" style={{ color: theme.textColor }}>
        {theme.label}
      </Text>
      <ChevronDownIcon size={20} color="#9CA3AF" />
    </Pressable>
  );
}

export function CampaignStatusMenu({
  status,
  campaignName,
  readOnly = false,
  isPausing = false,
  isStarting = false,
  isStopping = false,
  onPause,
  onResume,
  onStop,
  onOpenMobileActionsSheet,
}: CampaignStatusMenuProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const insideSheet = usePickerInsideBottomSheet();
  const triggerRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);

  const hasActions =
    !readOnly && (status === 'running' || status === 'paused' || status === 'scheduled') && onStop != null;
  const busy = isPausing || isStarting || isStopping;

  const close = useCallback(() => setOpen(false), []);

  const openStopConfirm = useCallback(() => {
    close();
    setStopConfirmOpen(true);
  }, [close]);

  const closeStopConfirm = useCallback(() => setStopConfirmOpen(false), []);

  const handleConfirmStop = useCallback(async () => {
    await onStop?.();
    setStopConfirmOpen(false);
  }, [onStop]);

  const handlePauseInstead = useCallback(async () => {
    await onPause?.();
    setStopConfirmOpen(false);
  }, [onPause]);

  const items = useMemo((): MenuItem[] => {
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
    (item: MenuItem) => {
      if (item.disabled || !item.onPress) return;
      close();
      item.onPress();
    },
    [close],
  );

  const renderItem = useCallback(
    (item: MenuItem, rowClassName: string, iconSize = 18) => {
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
          className={`${rowClassName} ${item.disabled ? 'opacity-50' : ''}`}
          accessibilityRole="button"
          accessibilityLabel={item.label}
        >
          <Icon size={iconSize} color={color} />
          <Text className={textClassName}>{item.label}</Text>
        </Pressable>
      );
    },
    [handleItemPress],
  );

  const menuPanel = (
    <View style={getFormDropdownPanelStyle({ maxHeight: 200, minWidth: 180 })}>
      <View className="gap-1 p-2">{items.map((item) => renderItem(item, desktopRowClassName))}</View>
    </View>
  );

  const theme = STATUS_TRIGGER_THEME[status];

  const pillTriggerContent = (
    <>
      <Text className="font-instrument-medium text-sm" style={{ color: theme.textColor }}>
        {theme.label}
      </Text>
      {hasActions ? (
        <ChevronDownIcon
          size={14}
          color={theme.textColor}
          style={{
            transform: [{ rotate: open ? '180deg' : '0deg' }],
            ...(Platform.OS === 'web' ? { transition: 'transform 150ms ease' } : {}),
          }}
        />
      ) : null}
    </>
  );

  const pillTriggerStyle = {
    backgroundColor: theme.backgroundColor,
    borderColor: theme.borderColor,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  };

  const stopConfirmModal = (
    <CampaignStopConfirmModal
      visible={stopConfirmOpen}
      onClose={closeStopConfirm}
      onConfirmStop={handleConfirmStop}
      onPauseInstead={status === 'running' ? handlePauseInstead : undefined}
      campaignName={campaignName}
      isLoading={isStopping}
      isPausing={isPausing}
    />
  );

  if (isMobile && insideSheet) {
    return (
      <CampaignStatusSheetTriggerRow
        status={status}
        hasActions={hasActions}
        busy={busy}
        onPress={hasActions ? onOpenMobileActionsSheet : undefined}
      />
    );
  }

  if (!hasActions) {
    return <View style={pillTriggerStyle}>{pillTriggerContent}</View>;
  }

  return (
    <>
      <View ref={triggerRef} collapsable={false}>
        <Pressable
          onPress={() => setOpen((current) => !current)}
          disabled={busy}
          style={[pillTriggerStyle, busy ? { opacity: 0.6 } : null]}
          accessibilityRole="button"
          accessibilityLabel={`Campaign status: ${status}. Open actions.`}
        >
          {pillTriggerContent}
        </Pressable>
      </View>

      {isMobile ? (
        <BottomSheet visible={open} onClose={close}>
          <View className="border-b border-[#2A2A2A] pb-3 mb-1">
            <Text className="text-white font-instrument-semibold text-base">Campaign status</Text>
          </View>
          <View className="gap-2 p-2">
            {items.map((item) => renderItem(item, sheetRowClassName, 20))}
          </View>
        </BottomSheet>
      ) : (
        <PopupPortal
          anchorRef={triggerRef}
          open={open}
          onClose={close}
          placement="bottom-end"
          gap={6}
        >
          {menuPanel}
        </PopupPortal>
      )}

      {stopConfirmModal}
    </>
  );
}

/** @deprecated Use CampaignStatusMenu */
export const MissionControlStatusMenu = CampaignStatusMenu;
/** @deprecated Use CampaignStatusMenuProps */
export type MissionControlStatusMenuProps = CampaignStatusMenuProps;
