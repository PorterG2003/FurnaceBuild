import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
  useWindowDimensions,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { ChevronDownIcon, MagnifyingGlassIcon } from 'react-native-heroicons/outline';
import {
  BottomSheet,
  useBottomSheetTakeover,
  usePickerInsideBottomSheet,
} from '@/components/ui/modals';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';

interface SelectPropsBase<T> {
  items: T[];
  getItemId: (item: T) => string;
  getItemLabel: (item: T) => { primary: string; secondary?: string };
  value: string | null;
  onChange: (id: string, item: T | null) => void;
  loading?: boolean;
  label?: string;
  placeholder?: string;
  emptyMessage?: (hasSearch: boolean) => string;
  listMaxHeight?: number;
  loadingMessage?: string;
  noMargin?: boolean;
  size?: 'default' | 'compact';
  panelSize?: 'default' | 'compact';
  dropdownMinWidth?: number;
  dropdownMaxWidth?: number;
  /** Optional: return hex color for item to show a colored dot next to the label (list and trigger). */
  getItemColor?: (item: T) => string | null | undefined;
  /** When getItemColor is used: 'dot' = small dot indicator (default); 'tint' = full-row translucent background + border. */
  itemColorVariant?: 'dot' | 'tint';
  /** Optional custom trigger. When provided, replaces the default trigger; use for icon buttons etc. */
  renderTrigger?: (props: { open: boolean; onPress: () => void }) => React.ReactNode;
  /** When true, the trigger does not open the list (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** When provided, rows returning true are non-interactive and styled as disabled. */
  isItemDisabled?: (item: T) => boolean;
}

export interface SelectPropsSearchable<T> extends SelectPropsBase<T> {
  searchable: true;
  onSearchChange: (search: string) => void;
  searchPlaceholder?: string;
  searchValue?: string;
}

export interface SelectPropsNonSearchable<T> extends SelectPropsBase<T> {
  searchable?: false;
  onSearchChange?: (search: string) => void;
  searchPlaceholder?: string;
  searchValue?: string;
}

export type SelectProps<T> = SelectPropsSearchable<T> | SelectPropsNonSearchable<T>;

const defaultEmptyMessage = (hasSearch: boolean) =>
  hasSearch ? 'No results.' : 'No items.';

function hexToTranslucentBackground(hex: string, alpha = 0.12): string {
  const match = hex.replace('#', '').match(/.{2}/g);
  if (!match) return `rgba(243, 68, 13, ${alpha})`;
  const r = parseInt(match[0], 16);
  const g = parseInt(match[1], 16);
  const b = parseInt(match[2], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const triggerStyle = {
  borderColor: '#FFFFFF4D',
  backgroundColor: '#FFFFFF0D',
  borderWidth: 1,
};
const noSelectStyle = Platform.OS === 'web' ? ({ userSelect: 'none' } as const) : undefined;
const textInputWebStyle = Platform.OS === 'web' ? ({ userSelect: 'text' } as const) : undefined;

const sizeStyles = {
  default: {
    trigger: {
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 44,
    },
    triggerTextClassName: 'text-sm' as const,
    chevronSize: 18,
    row: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginBottom: 6 },
  },
  compact: {
    trigger: {
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      minHeight: 32,
    },
    triggerTextClassName: 'text-xs' as const,
    chevronSize: 14,
    row: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, marginBottom: 4 },
  },
} as const;

const panelSizeStyles = {
  default: {
    panelPadding: 10,
    searchRadius: 10,
    searchPaddingX: 10,
    searchPaddingY: 8,
    searchMarginBottom: 8,
    searchIconSize: 16,
    searchTextSize: 14,
    loadingTextClassName: 'text-sm' as const,
    emptyPrimaryTextClassName: 'text-sm' as const,
    emptySecondaryTextClassName: 'text-xs' as const,
    rowPrimaryTextClassName: 'text-sm' as const,
    rowSecondaryTextClassName: 'text-xs' as const,
  },
  compact: {
    panelPadding: 8,
    searchRadius: 8,
    searchPaddingX: 8,
    searchPaddingY: 6,
    searchMarginBottom: 6,
    searchIconSize: 14,
    searchTextSize: 12,
    loadingTextClassName: 'text-xs' as const,
    emptyPrimaryTextClassName: 'text-xs' as const,
    emptySecondaryTextClassName: 'text-[11px]' as const,
    rowPrimaryTextClassName: 'text-xs' as const,
    rowSecondaryTextClassName: 'text-[11px]' as const,
  },
} as const;

export function Select<T>({
  items,
  getItemId,
  getItemLabel,
  value,
  onChange,
  onSearchChange,
  loading = false,
  label,
  searchPlaceholder = 'Search…',
  searchValue: controlledSearchValue,
  placeholder = 'Select…',
  emptyMessage = defaultEmptyMessage,
  listMaxHeight = 280,
  loadingMessage = 'Loading…',
  noMargin = false,
  searchable = true,
  size = 'default',
  panelSize = size,
  dropdownMinWidth,
  dropdownMaxWidth,
  getItemColor,
  itemColorVariant = 'dot',
  renderTrigger,
  disabled = false,
  isItemDisabled,
}: SelectProps<T>) {
  const sz = sizeStyles[size];
  const panel = panelSizeStyles[panelSize];
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isCompactLayout = screenWidth < LAYOUT_BREAKPOINT;
  const insideSheet = usePickerInsideBottomSheet();
  const { presentTakeover, dismissTakeover } = useBottomSheetTakeover();
  const [open, setOpen] = useState(false);
  const [internalSearch, setInternalSearch] = useState('');
  const [triggerLayout, setTriggerLayout] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const triggerRef = useRef<View>(null);
  const searchInputRef = useRef<TextInput>(null);

  const searchValue =
    controlledSearchValue !== undefined ? controlledSearchValue : internalSearch;

  const handleSearchChange = useCallback(
    (text: string) => {
      if (controlledSearchValue === undefined) setInternalSearch(text);
      onSearchChange?.(text);
    },
    [controlledSearchValue, onSearchChange]
  );

  const openPopover = useCallback(() => {
    if (disabled) return;
    setOpen(true);
  }, [disabled]);

  const closePopover = useCallback(() => {
    setOpen(false);
  }, []);

  const handleSelect = useCallback(
    (id: string, item: T | null) => {
      if (item != null && isItemDisabled?.(item)) return;
      onChange(id, item);
      closePopover();
    },
    [onChange, closePopover, isItemDisabled]
  );

  // Measure trigger position when opening (for popover placement only)
  useEffect(() => {
    if (!open || isCompactLayout) {
      setTriggerLayout(null);
      return;
    }
    const measure = () => {
      triggerRef.current?.measureInWindow((x, y, w, h) => {
        setTriggerLayout({ x, y, w, h });
      });
    };
    measure();
    const t = setTimeout(measure, 50);
    return () => clearTimeout(t);
  }, [open, isCompactLayout]);

  // Focus search when popover opens (only when searchable). Skip auto-focus inside a parent
  // BottomSheet takeover so the keyboard does not cover the list until the user taps search.
  useEffect(() => {
    if (open && searchable) {
      if (insideSheet) return;
      const t = setTimeout(() => searchInputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [open, searchable, insideSheet]);

  // Escape to close (web)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopover();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }
  }, [open, closePopover]);

  const selectedItem = value != null ? items.find((i) => getItemId(i) === value) ?? null : null;
  const selectedLabel = selectedItem ? getItemLabel(selectedItem).primary : null;
  const displayText = selectedLabel ?? placeholder;
  const triggerColor =
    selectedItem && getItemColor ? getItemColor(selectedItem) ?? null : null;

  const rowStyle = useCallback(
    (isSelected: boolean, itemColor?: string | null) => {
      const base = {
        ...sz.row,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        borderWidth: 1,
      };
      if (itemColorVariant === 'tint' && itemColor) {
        // Keep category tint identical for selected vs unselected so the swatch matches
        // the closed trigger (which uses `${color}66`); do not intensify border on select.
        return {
          ...base,
          backgroundColor: hexToTranslucentBackground(itemColor),
          borderColor: `${itemColor}66`,
        };
      }
      // Tint + no item color (e.g. "No category"): same neutral row when selected or not —
      // avoids orange highlight that disagrees with the closed trigger chrome.
      if (itemColorVariant === 'tint' && !itemColor) {
        return { ...base, backgroundColor: '#121212', borderColor: '#2A2A2A' };
      }
      if (isSelected) {
        return { ...base, backgroundColor: 'rgba(243, 68, 13, 0.14)', borderColor: 'rgba(243, 68, 13, 0.4)' };
      }
      return { ...base, backgroundColor: '#121212', borderColor: '#2A2A2A' };
    },
    [sz.row, itemColorVariant]
  );

  const hasSearchText = searchable && searchValue.trim().length > 0;
  const dropdownContentHeight = searchable ? listMaxHeight + 120 : listMaxHeight + 24;
  const sheetBodyMaxHeight = Math.min(dropdownContentHeight, screenHeight * 0.55);
  const takeoverListMax = Math.min(listMaxHeight, Math.floor(screenHeight * 0.65));

  const renderListPanel = useCallback(
    (listScrollMax: number = listMaxHeight) => (
    <View style={{ padding: panel.panelPadding, ...noSelectStyle }}>
      {searchable && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#FFFFFF0D',
            borderRadius: panel.searchRadius,
            borderWidth: 1,
            borderColor: '#FFFFFF4D',
            paddingHorizontal: panel.searchPaddingX,
            paddingVertical: panel.searchPaddingY,
            marginBottom: panel.searchMarginBottom,
            ...noSelectStyle,
          }}
        >
          <MagnifyingGlassIcon size={panel.searchIconSize} color="#9CA3AF" style={{ marginRight: 8 }} />
          <TextInput
            ref={searchInputRef}
            value={searchValue}
            onChangeText={handleSearchChange}
            placeholder={searchPlaceholder}
            placeholderTextColor="#666"
            style={{
              flex: 1,
              color: '#FFFFFF',
              fontSize: panel.searchTextSize,
              fontFamily: 'Instrument Sans, system-ui, sans-serif',
              paddingVertical: 0,
              ...textInputWebStyle,
            }}
            selectionColor="#FF4D00"
            underlineColorAndroid="transparent"
          />
        </View>
      )}
      {loading ? (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}>
          <Text
            selectable={false}
            className={`text-gray-500 ${panel.loadingTextClassName}`}
            style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
          >
            {loadingMessage}
          </Text>
        </View>
      ) : items.length === 0 ? (
        <View
          style={{
            paddingVertical: 32,
            paddingHorizontal: 16,
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 80,
          }}
        >
          <Text
            selectable={false}
            className={`text-gray-400 ${panel.emptyPrimaryTextClassName}`}
            style={{
              fontFamily: 'Instrument Sans, system-ui, sans-serif',
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            {emptyMessage(hasSearchText)}
          </Text>
          {hasSearchText && (
            <Text
              selectable={false}
              className={`text-gray-500 mt-1 ${panel.emptySecondaryTextClassName}`}
              style={{
                fontFamily: 'Instrument Sans, system-ui, sans-serif',
                textAlign: 'center',
              }}
            >
              Try a different search term.
            </Text>
          )}
        </View>
      ) : (
        <ScrollView
          style={{ maxHeight: listScrollMax }}
          showsVerticalScrollIndicator
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {items.map((item) => {
            const id = getItemId(item);
            const { primary, secondary } = getItemLabel(item);
            const isSelected = value === id;
            const itemColor = getItemColor ? getItemColor(item) ?? null : null;
            const rowDisabled = isItemDisabled?.(item) ?? false;
            return (
              <TouchableOpacity
                key={id}
                onPress={() => handleSelect(id, item)}
                disabled={rowDisabled}
                accessibilityState={{ disabled: rowDisabled }}
                style={{
                  ...rowStyle(isSelected, itemColor),
                  ...noSelectStyle,
                  ...(rowDisabled ? { opacity: 0.45 } : null),
                }}
              >
                {itemColorVariant === 'dot' && getItemColor && itemColor ? (
                  <View
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: itemColor,
                      borderWidth: 1,
                      borderColor: '#3A3A3A',
                      marginRight: 8,
                    }}
                  />
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text
                    selectable={false}
                    className={`text-white font-instrument-medium ${panel.rowPrimaryTextClassName}`}
                    style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
                    numberOfLines={1}
                  >
                    {primary}
                  </Text>
                  {secondary != null && secondary !== '' && (
                    <Text
                      selectable={false}
                      className={`text-gray-400 mt-0.5 ${panel.rowSecondaryTextClassName}`}
                      style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
                      numberOfLines={1}
                    >
                      {secondary}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
    ),
    [
      searchable,
      searchValue,
      handleSearchChange,
      searchPlaceholder,
      loading,
      loadingMessage,
      items,
      emptyMessage,
      hasSearchText,
      getItemId,
      getItemLabel,
      value,
      getItemColor,
      itemColorVariant,
      rowStyle,
      handleSelect,
      listMaxHeight,
      panel,
      isItemDisabled,
    ]
  );

  useLayoutEffect(() => {
    if (!isCompactLayout) {
      dismissTakeover();
      return;
    }
    if (!insideSheet) return;
    if (!open) {
      dismissTakeover();
      return;
    }
    presentTakeover({
      title: label ?? null,
      content: renderListPanel(takeoverListMax),
      onRequestDismiss: closePopover,
    });
  }, [
    isCompactLayout,
    insideSheet,
    open,
    dismissTakeover,
    presentTakeover,
    label,
    closePopover,
    renderListPanel,
    takeoverListMax,
  ]);

  return (
    <View style={{ marginBottom: noMargin ? 0 : 12 }}>
      {label != null && (
        <Text
          selectable={false}
          className="text-xs font-instrument-medium mb-2 text-gray-400"
          style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
        >
          {label}
        </Text>
      )}
      {renderTrigger ? (
        <View
          ref={triggerRef}
          onLayout={() => {
            if (open) triggerRef.current?.measureInWindow((x, y, w, h) => setTriggerLayout({ x, y, w, h }));
          }}
          collapsable={false}
        >
          {renderTrigger({ open, onPress: openPopover })}
        </View>
      ) : (
        <TouchableOpacity
          ref={triggerRef}
          onLayout={() => {
            if (open) triggerRef.current?.measureInWindow((x, y, w, h) => setTriggerLayout({ x, y, w, h }));
          }}
          onPress={openPopover}
          disabled={disabled}
          accessibilityState={{ disabled }}
          activeOpacity={0.8}
          style={[
            itemColorVariant === 'tint' && triggerColor
              ? {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  ...sz.trigger,
                  backgroundColor: hexToTranslucentBackground(triggerColor),
                  borderWidth: 1,
                  borderColor: `${triggerColor}66`,
                }
              : { ...triggerStyle, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...sz.trigger },
            noSelectStyle,
            disabled ? { opacity: 0.45 } : null,
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, marginRight: 10 }}>
            {triggerColor && itemColorVariant === 'dot' ? (
              <View
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: triggerColor,
                  borderWidth: 1,
                  borderColor: '#3A3A3A',
                  marginRight: 8,
                }}
              />
            ) : null}
            <Text
              selectable={false}
              className={`${sz.triggerTextClassName} text-white`}
              style={{
                fontFamily: 'Instrument Sans, system-ui, sans-serif',
                flex: 1,
                color: selectedLabel ? '#FFFFFF' : '#666666',
              }}
              numberOfLines={1}
            >
              {displayText}
            </Text>
          </View>
          <ChevronDownIcon size={sz.chevronSize} color="#9CA3AF" />
        </TouchableOpacity>
      )}

      {isCompactLayout ? (
        insideSheet ? null : (
          <BottomSheet visible={open} onClose={closePopover}>
            <View style={{ maxHeight: sheetBodyMaxHeight }}>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ flex: 1 }}
              >
                {renderListPanel()}
              </KeyboardAvoidingView>
            </View>
          </BottomSheet>
        )
      ) : (
        <Modal visible={open} transparent animationType="fade" onRequestClose={closePopover}>
          <Pressable style={{ flex: 1 }} onPress={closePopover}>
            {triggerLayout &&
              (() => {
                let w = triggerLayout.w;
                if (dropdownMinWidth != null) w = Math.max(w, dropdownMinWidth);
                if (dropdownMaxWidth != null) w = Math.min(w, dropdownMaxWidth);
                const gap = 4;
                const edgeInset = 8;
                const spaceBelow = screenHeight - (triggerLayout.y + triggerLayout.h + gap);
                const spaceAbove = triggerLayout.y;
                const openAbove = spaceBelow < dropdownContentHeight && spaceAbove >= spaceBelow;
                const top = openAbove
                  ? Math.max(edgeInset, triggerLayout.y - dropdownContentHeight - gap)
                  : Math.min(
                      Math.max(edgeInset, triggerLayout.y + triggerLayout.h + gap),
                      screenHeight - dropdownContentHeight - edgeInset
                    );
                const left = Math.max(
                  edgeInset,
                  Math.min(triggerLayout.x, screenWidth - w - edgeInset)
                );
                return (
                  <Pressable
                    style={{
                      position: 'absolute',
                      left,
                      top,
                      width: w,
                      maxHeight: dropdownContentHeight,
                      backgroundColor: '#1A1A1A',
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: '#2A2A2A',
                      ...(typeof window !== 'undefined'
                        ? { boxShadow: '0px 8px 16px rgba(0,0,0,0.35)' }
                        : {
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 8 },
                            shadowOpacity: 0.35,
                            shadowRadius: 16,
                            elevation: 12,
                          }),
                      overflow: 'hidden',
                    }}
                    onPress={(e) => e?.stopPropagation?.()}
                  >
                    {renderListPanel(listMaxHeight)}
                  </Pressable>
                );
              })()}
          </Pressable>
        </Modal>
      )}
    </View>
  );
}
