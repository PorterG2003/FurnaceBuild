import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import {
  PauseIcon,
  PlayIcon,
  PlusCircleIcon,
  QueueListIcon,
  RocketLaunchIcon,
  TrashIcon,
} from 'react-native-heroicons/outline';
import { Button } from '@/components/ui/button';
import { BottomSheet } from '@/components/ui/modals';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import type {
  LeadsWorkbenchActionGroup,
  LeadsWorkbenchActionItem,
} from '@/lib/leads/workbench/buildLeadsWorkbenchActionGroups';

type MenuIcon = ComponentType<{ size?: number; color?: string }>;

const ACTION_ICONS: Record<string, MenuIcon> = {
  'add-to-campaign': RocketLaunchIcon,
  'add-all-to-campaign': RocketLaunchIcon,
  'remove-from-campaigns': TrashIcon,
  'add-to-list': PlusCircleIcon,
  'add-view-to-list': PlusCircleIcon,
  'remove-from-list': TrashIcon,
  'remove-all-from-list': TrashIcon,
  'remove-filtered-from-list': TrashIcon,
  'remove-view-from-list': TrashIcon,
  'create-list-from-selection': QueueListIcon,
  'save-view-as-list': QueueListIcon,
  pause: PauseIcon,
  resume: PlayIcon,
};

const EDGE_INSET = 8;
const MENU_GAP = 6;
const MENU_VERTICAL_PADDING = 16;
const GROUP_HEADER_HEIGHT = 24;
const MENU_ROW_HEIGHT_ESTIMATE = 38;

const desktopRowClass =
  'flex-row items-center gap-2 rounded-md px-2 py-2 web:transition-colors web:duration-150 web:hover:bg-white/10 web:active:bg-white/5';

const mobileRowClass = 'flex-row items-center gap-3 py-3';

function getActionIcon(item: LeadsWorkbenchActionItem): MenuIcon {
  return ACTION_ICONS[item.key] ?? QueueListIcon;
}

export function LeadsWorkbenchActionsMenu({
  groups,
  disabled = false,
  sheetTitle = 'Actions',
  menuMinWidth = 280,
  accessibilityLabel = 'Lead actions',
}: {
  groups: LeadsWorkbenchActionGroup[];
  disabled?: boolean;
  sheetTitle?: string;
  menuMinWidth?: number;
  accessibilityLabel?: string;
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isMobile = screenWidth < LAYOUT_BREAKPOINT;
  const anchorRef = useRef<View>(null);
  const menuPanelRef = useRef<View>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [anchorLayout, setAnchorLayout] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );

  const itemCount = useMemo(
    () => groups.reduce((total, group) => total + group.items.length, 0),
    [groups],
  );

  const estimatedMenuHeight = useMemo(
    () =>
      MENU_VERTICAL_PADDING +
      groups.length * GROUP_HEADER_HEIGHT +
      itemCount * MENU_ROW_HEIGHT_ESTIMATE +
      Math.max(0, groups.length - 1) * 8,
    [groups.length, itemCount],
  );

  const [menuHeight, setMenuHeight] = useState(estimatedMenuHeight);

  useEffect(() => {
    setMenuHeight(estimatedMenuHeight);
  }, [estimatedMenuHeight]);

  const closeAll = useCallback(() => {
    setSheetOpen(false);
    setAnchorLayout(null);
  }, []);

  const openMenu = useCallback(() => {
    if (disabled || groups.length === 0) return;
    if (isMobile) {
      setSheetOpen(true);
      return;
    }
    requestAnimationFrame(() => {
      anchorRef.current?.measureInWindow((x, y, w, h) => {
        setAnchorLayout({ x, y, w, h });
      });
    });
  }, [disabled, groups.length, isMobile]);

  useEffect(() => {
    if (!anchorLayout || isMobile || Platform.OS !== 'web') return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const anchorEl = anchorRef.current as unknown as { contains?: (n: Node) => boolean } | null;
      const panelEl = menuPanelRef.current as unknown as { contains?: (n: Node) => boolean } | null;
      if (anchorEl?.contains?.(target)) return;
      if (panelEl?.contains?.(target)) return;
      setAnchorLayout(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAnchorLayout(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorLayout, isMobile]);

  const desktopPosition = useMemo(() => {
    if (!anchorLayout) return null;
    const rawLeft = anchorLayout.x + anchorLayout.w - menuMinWidth;
    const left = Math.max(EDGE_INSET, Math.min(rawLeft, screenWidth - menuMinWidth - EDGE_INSET));
    const spaceBelow = screenHeight - (anchorLayout.y + anchorLayout.h + MENU_GAP);
    const spaceAbove = anchorLayout.y;
    const openAbove = spaceBelow < menuHeight && spaceAbove >= spaceBelow;
    const top = openAbove
      ? Math.max(EDGE_INSET, anchorLayout.y - menuHeight - MENU_GAP)
      : Math.min(
          Math.max(EDGE_INSET, anchorLayout.y + anchorLayout.h + MENU_GAP),
          screenHeight - menuHeight - EDGE_INSET,
        );
    return { top, left };
  }, [anchorLayout, menuHeight, menuMinWidth, screenHeight, screenWidth]);

  const handleMenuLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight > 0) {
      setMenuHeight((current) => (current === nextHeight ? current : nextHeight));
    }
  }, []);

  const handleItemPress = useCallback(
    (item: LeadsWorkbenchActionItem) => {
      if (item.disabled) return;
      closeAll();
      item.onPress();
    },
    [closeAll],
  );

  const renderItem = useCallback(
    (item: LeadsWorkbenchActionItem, rowClassName: string, iconSize = 18) => {
      const color = item.tone === 'destructive' ? '#f87171' : '#9CA3AF';
      const textClassName =
        item.tone === 'destructive'
          ? 'text-red-400 font-instrument-medium text-sm'
          : 'text-white font-instrument-medium text-sm';
      const Icon = getActionIcon(item);
      const itemAccessibilityLabel =
        item.tone === 'destructive' ? `${item.label}, destructive action` : item.label;

      return (
        <Pressable
          key={item.key}
          onPress={() => handleItemPress(item)}
          disabled={item.disabled}
          className={`${rowClassName} ${item.disabled ? 'opacity-50' : ''}`}
          accessibilityRole="button"
          accessibilityLabel={itemAccessibilityLabel}
        >
          <Icon size={iconSize} color={color} />
          <Text className={textClassName}>{item.label}</Text>
        </Pressable>
      );
    },
    [handleItemPress],
  );

  const renderGroups = useCallback(
    (rowClassName: string, iconSize?: number) => (
      <View className="gap-2">
        {groups.map((group, groupIndex) => (
          <View key={group.id}>
            {groupIndex > 0 ? <View className="border-t border-[#2A2A2A] pt-2 mt-1" /> : null}
            <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider px-2 pb-1">
              {group.title}
            </Text>
            <View className="gap-1">
              {group.items.map((item) => renderItem(item, rowClassName, iconSize))}
            </View>
          </View>
        ))}
      </View>
    ),
    [groups, renderItem],
  );

  return (
    <>
      <View ref={anchorRef} collapsable={false} className="shrink-0">
        <Button size="sm" onPress={openMenu} disabled={disabled || groups.length === 0} accessibilityLabel={accessibilityLabel}>
          Actions
        </Button>
      </View>

      {isMobile ? (
        <BottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)}>
          <View className="border-b border-[#2A2A2A] pb-3 mb-1">
            <Text className="text-white font-instrument-semibold text-base">{sheetTitle}</Text>
          </View>
          {renderGroups(mobileRowClass, 20)}
        </BottomSheet>
      ) : (
        <Modal
          transparent
          visible={desktopPosition != null}
          animationType="fade"
          onRequestClose={() => setAnchorLayout(null)}
        >
          {desktopPosition ? (
            <View style={styles.modalRoot} pointerEvents="box-none">
              {Platform.OS !== 'web' ? (
                <Pressable
                  style={styles.nativeDismiss}
                  onPress={() => setAnchorLayout(null)}
                  accessibilityLabel="Dismiss menu"
                />
              ) : null}
              <View
                ref={menuPanelRef}
                collapsable={false}
                onLayout={handleMenuLayout}
                style={[
                  styles.dropdown,
                  dropdownShadowStyle,
                  {
                    top: desktopPosition.top,
                    left: desktopPosition.left,
                    minWidth: menuMinWidth,
                  },
                ]}
                className="rounded-xl border border-[#2A2A2A] bg-[#1A1A1A]"
              >
                <View className="p-2">{renderGroups(desktopRowClass)}</View>
              </View>
            </View>
          ) : null}
        </Modal>
      )}
    </>
  );
}

const dropdownShadowStyle =
  Platform.OS === 'web'
    ? { boxShadow: '0px 8px 20px rgba(0,0,0,0.45)' }
    : {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.45,
        shadowRadius: 20,
      };

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  nativeDismiss: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  dropdown: {
    position: 'absolute',
    zIndex: 10,
    elevation: 16,
  },
});
