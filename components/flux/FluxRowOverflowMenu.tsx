import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { EllipsisVerticalIcon, PencilSquareIcon, TrashIcon } from 'react-native-heroicons/outline';
import { IconButton } from '@/components/ui/icon-button';
import { BottomSheet } from '@/components/ui/modals';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';

const MENU_MIN_WIDTH = 148;

/** Desktop rows: equal horizontal/vertical padding; hover background only. */
const desktopRowClass =
  'flex-row items-center gap-2 rounded-md px-2 py-2 web:transition-colors web:duration-150 web:hover:bg-white/10 web:active:bg-white/5';

/** Match desktop insets so mobile sheet feels the same. */
const mobileRowClass = 'flex-row items-center gap-2 rounded-md px-2 py-2';

export interface FluxRowOverflowMenuProps {
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
  /** Optional label for the bottom sheet header (mobile). */
  sheetTitle?: string;
}

/**
 * Row overflow: three-dot trigger. Mobile uses BottomSheet; desktop uses a floating panel
 * (Modal + measureInWindow) with shadow only — no dimmed overlay. Web: pointerdown outside closes.
 */
export function FluxRowOverflowMenu({
  onEdit,
  onDelete,
  disabled = false,
  sheetTitle,
}: FluxRowOverflowMenuProps) {
  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < LAYOUT_BREAKPOINT;
  const anchorRef = useRef<View>(null);
  const menuPanelRef = useRef<View>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dropdown, setDropdown] = useState<{ top: number; left: number } | null>(null);

  const closeAll = useCallback(() => {
    setSheetOpen(false);
    setDropdown(null);
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    if (isMobile) {
      setSheetOpen(true);
      return;
    }
    requestAnimationFrame(() => {
      anchorRef.current?.measureInWindow((x, y, _w, h) => {
        setDropdown({ top: y + h + 6, left: x });
      });
    });
  }, [disabled, isMobile]);

  const handleEdit = useCallback(() => {
    closeAll();
    onEdit();
  }, [closeAll, onEdit]);

  const handleDelete = useCallback(() => {
    closeAll();
    onDelete();
  }, [closeAll, onDelete]);

  useEffect(() => {
    if (!dropdown || isMobile || Platform.OS !== 'web') return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const anchorEl = anchorRef.current as unknown as { contains?: (n: Node) => boolean } | null;
      const panelEl = menuPanelRef.current as unknown as { contains?: (n: Node) => boolean } | null;
      if (anchorEl?.contains?.(target)) return;
      if (panelEl?.contains?.(target)) return;
      setDropdown(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [dropdown, isMobile]);

  const clampedLeft =
    dropdown != null
      ? Math.max(8, Math.min(dropdown.left, screenWidth - MENU_MIN_WIDTH - 8))
      : 0;

  const mobileMenu = (
    <View className="gap-2 p-2">
      <Pressable
        onPress={handleEdit}
        className={mobileRowClass}
        accessibilityRole="button"
        accessibilityLabel="Edit"
      >
        <PencilSquareIcon size={18} color="#9CA3AF" />
        <Text className="text-white font-instrument-medium text-sm">Edit</Text>
      </Pressable>
      <Pressable
        onPress={handleDelete}
        className={mobileRowClass}
        accessibilityRole="button"
        accessibilityLabel="Delete"
      >
        <TrashIcon size={18} color="#f87171" />
        <Text className="text-red-400 font-instrument-medium text-sm">Delete</Text>
      </Pressable>
    </View>
  );

  const desktopMenu = (
    <View className="gap-2 p-2">
      <Pressable
        onPress={handleEdit}
        className={desktopRowClass}
        accessibilityRole="button"
        accessibilityLabel="Edit"
      >
        <PencilSquareIcon size={18} color="#9CA3AF" />
        <Text className="text-white font-instrument-medium text-sm">Edit</Text>
      </Pressable>
      <Pressable
        onPress={handleDelete}
        className={desktopRowClass}
        accessibilityRole="button"
        accessibilityLabel="Delete"
      >
        <TrashIcon size={18} color="#f87171" />
        <Text className="text-red-400 font-instrument-medium text-sm">Delete</Text>
      </Pressable>
    </View>
  );

  return (
    <>
      <View ref={anchorRef} collapsable={false} className="shrink-0 self-start">
        <IconButton
          icon={EllipsisVerticalIcon}
          variant="overflow"
          onPress={openMenu}
          disabled={disabled}
          hitSlop={8}
          accessibilityLabel="Row actions"
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
          {mobileMenu}
        </BottomSheet>
      ) : (
        <Modal
          transparent
          visible={dropdown != null}
          animationType="fade"
          onRequestClose={() => setDropdown(null)}
        >
          {dropdown ? (
            <View style={styles.modalRoot} pointerEvents="box-none">
              {Platform.OS !== 'web' ? (
                <Pressable
                  style={styles.nativeDismiss}
                  onPress={() => setDropdown(null)}
                  accessibilityLabel="Dismiss menu"
                />
              ) : null}
              <View
                ref={menuPanelRef}
                collapsable={false}
                style={[
                  styles.dropdown,
                  styles.dropdownShadow,
                  {
                    top: dropdown.top,
                    left: clampedLeft,
                    minWidth: MENU_MIN_WIDTH,
                  },
                ]}
                className="rounded-xl border border-[#2A2A2A] bg-[#1A1A1A] shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
              >
                {desktopMenu}
              </View>
            </View>
          ) : null}
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  /** Invisible tap target: native has no document outside-click; no dimming. */
  nativeDismiss: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  dropdown: {
    position: 'absolute',
    zIndex: 10,
    elevation: 16,
  },
  dropdownShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
  },
});
