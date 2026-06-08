import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
  type LayoutChangeEvent,
} from 'react-native';
import { EllipsisVerticalIcon } from 'react-native-heroicons/outline';
import { BottomSheet } from '@/components/ui/modals';
import { IconButton } from '@/components/ui/icon-button';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';

const EDGE_INSET = 8;
const MENU_GAP = 6;
const MENU_VERTICAL_PADDING = 16;
const MENU_ROW_HEIGHT_ESTIMATE = 38;

const desktopRowClass =
  'flex-row items-center gap-2 rounded-md px-2 py-2 web:transition-colors web:duration-150 web:hover:bg-white/10 web:active:bg-white/5';

const mobileRowClass = 'flex-row items-center gap-2 rounded-md px-2 py-2';

type MenuIcon = React.ComponentType<{ size?: number; color?: string }>;

export interface RowOverflowMenuItem {
  key: string;
  label: string;
  onPress: () => void;
  icon: MenuIcon;
  accessibilityLabel?: string;
  tone?: 'default' | 'destructive';
}

export interface RowOverflowMenuProps {
  items: RowOverflowMenuItem[];
  disabled?: boolean;
  sheetTitle?: string;
  menuMinWidth?: number;
  triggerIcon?: MenuIcon;
  triggerAccessibilityLabel?: string;
  horizontalAlign?: 'start' | 'end';
  triggerContainerClassName?: string;
  triggerContainerStyle?: StyleProp<ViewStyle>;
}

export function RowOverflowMenu({
  items,
  disabled = false,
  sheetTitle,
  menuMinWidth = 148,
  triggerIcon: TriggerIcon = EllipsisVerticalIcon,
  triggerAccessibilityLabel = 'Row actions',
  horizontalAlign = 'start',
  triggerContainerClassName,
  triggerContainerStyle,
}: RowOverflowMenuProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isMobile = screenWidth < LAYOUT_BREAKPOINT;
  const anchorRef = useRef<View>(null);
  const menuPanelRef = useRef<View>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [anchorLayout, setAnchorLayout] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const estimatedMenuHeight = useMemo(
    () => MENU_VERTICAL_PADDING + items.length * MENU_ROW_HEIGHT_ESTIMATE,
    [items.length],
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
    if (disabled) return;
    if (isMobile) {
      setSheetOpen(true);
      return;
    }
    requestAnimationFrame(() => {
      anchorRef.current?.measureInWindow((x, y, w, h) => {
        setAnchorLayout({ x, y, w, h });
      });
    });
  }, [disabled, isMobile]);

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
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchorLayout, isMobile]);

  const desktopPosition = useMemo(() => {
    if (!anchorLayout) return null;
    const rawLeft =
      horizontalAlign === 'end'
        ? anchorLayout.x + anchorLayout.w - menuMinWidth
        : anchorLayout.x;
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
  }, [anchorLayout, horizontalAlign, menuHeight, menuMinWidth, screenHeight, screenWidth]);

  const handleMenuLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight > 0) {
      setMenuHeight((current) => (current === nextHeight ? current : nextHeight));
    }
  }, []);

  const renderItem = useCallback(
    (item: RowOverflowMenuItem, rowClassName: string) => {
      const color = item.tone === 'destructive' ? '#f87171' : '#9CA3AF';
      const textClassName =
        item.tone === 'destructive'
          ? 'text-red-400 font-instrument-medium text-sm'
          : 'text-white font-instrument-medium text-sm';
      const Icon = item.icon;
      return (
        <Pressable
          key={item.key}
          onPress={() => {
            closeAll();
            item.onPress();
          }}
          className={rowClassName}
          accessibilityRole="button"
          accessibilityLabel={item.accessibilityLabel ?? item.label}
        >
          <Icon size={18} color={color} />
          <Text className={textClassName}>{item.label}</Text>
        </Pressable>
      );
    },
    [closeAll],
  );

  return (
    <>
      <View
        ref={anchorRef}
        collapsable={false}
        className={triggerContainerClassName ?? 'shrink-0 self-start'}
        style={triggerContainerStyle}
      >
        <IconButton
          icon={TriggerIcon}
          variant="overflow"
          onPress={(e) => {
            e?.stopPropagation?.();
            openMenu();
          }}
          disabled={disabled}
          hitSlop={8}
          accessibilityLabel={triggerAccessibilityLabel}
        />
      </View>

      {isMobile ? (
        <BottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)}>
          {sheetTitle ? (
            <View className="border-b border-[#2A2A2A] pb-3 mb-1">
              <Text className="text-white font-instrument-semibold text-base" numberOfLines={2}>
                {sheetTitle}
              </Text>
            </View>
          ) : null}
          <View className="gap-2 p-2">
            {items.map((item) => renderItem(item, mobileRowClass))}
          </View>
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
                <View className="gap-2 p-2">
                  {items.map((item) => renderItem(item, desktopRowClass))}
                </View>
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
