import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { ChevronDownIcon, MagnifyingGlassIcon } from 'react-native-heroicons/outline';

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
  dropdownMinWidth?: number;
  dropdownMaxWidth?: number;
  /** Optional: return hex color for item to show a colored dot next to the label (list and trigger). */
  getItemColor?: (item: T) => string | null | undefined;
  /** When getItemColor is used: 'dot' = small dot indicator (default); 'tint' = full-row translucent background + border. */
  itemColorVariant?: 'dot' | 'tint';
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
  dropdownMinWidth,
  dropdownMaxWidth,
  getItemColor,
  itemColorVariant = 'dot',
}: SelectProps<T>) {
  const sz = sizeStyles[size];
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
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
    setOpen(true);
  }, []);

  const closePopover = useCallback(() => {
    setOpen(false);
  }, []);

  const handleSelect = useCallback(
    (id: string, item: T | null) => {
      onChange(id, item);
      closePopover();
    },
    [onChange, closePopover]
  );

  // Measure trigger position when opening (for popover placement)
  useEffect(() => {
    if (!open) {
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
  }, [open]);

  // Focus search when popover opens (only when searchable)
  useEffect(() => {
    if (open && searchable) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [open, searchable]);

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

  const rowStyle = (isSelected: boolean, itemColor?: string | null) => {
    const base = {
      ...sz.row,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      borderWidth: 1,
    };
    if (isSelected) {
      return { ...base, backgroundColor: 'rgba(243, 68, 13, 0.14)', borderColor: 'rgba(243, 68, 13, 0.4)' };
    }
    if (itemColorVariant === 'tint' && itemColor) {
      return {
        ...base,
        backgroundColor: hexToTranslucentBackground(itemColor),
        borderColor: `${itemColor}66`,
      };
    }
    return { ...base, backgroundColor: '#121212', borderColor: '#2A2A2A' };
  };

  const hasSearchText = searchable && searchValue.trim().length > 0;
  const dropdownContentHeight = searchable ? listMaxHeight + 120 : listMaxHeight + 24;

  return (
    <View style={{ marginBottom: noMargin ? 0 : 12 }}>
      {label != null && (
        <Text
          className="text-xs font-instrument-medium mb-2 text-gray-400"
          style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
        >
          {label}
        </Text>
      )}
      <TouchableOpacity
        ref={triggerRef}
        onLayout={() => {
          if (open) triggerRef.current?.measureInWindow((x, y, w, h) => setTriggerLayout({ x, y, w, h }));
        }}
        onPress={openPopover}
        activeOpacity={0.8}
        style={[
          triggerStyle,
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            ...sz.trigger,
          },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
          {itemColorVariant === 'tint' && triggerColor ? (
            <View
              style={{
                flex: 1,
                minWidth: 0,
                paddingVertical: 2,
                paddingHorizontal: 6,
                borderRadius: 6,
                backgroundColor: hexToTranslucentBackground(triggerColor),
                borderWidth: 1,
                borderColor: `${triggerColor}66`,
              }}
            >
              <Text
                className={`${sz.triggerTextClassName} text-white`}
                style={{
                  fontFamily: 'Instrument Sans, system-ui, sans-serif',
                  color: selectedLabel ? '#FFFFFF' : '#666666',
                }}
                numberOfLines={1}
              >
                {displayText}
              </Text>
            </View>
          ) : (
            <>
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
            </>
          )}
        </View>
        <ChevronDownIcon size={sz.chevronSize} color="#9CA3AF" />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={closePopover}
      >
        <Pressable style={{ flex: 1 }} onPress={closePopover}>
          {triggerLayout && (() => {
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
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.35,
                shadowRadius: 16,
                elevation: 12,
                overflow: 'hidden',
              }}
              onPress={(e) => e?.stopPropagation?.()}
            >
              <View style={{ padding: 10 }}>
                {searchable && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: '#FFFFFF0D',
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: '#FFFFFF4D',
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      marginBottom: 8,
                    }}
                  >
                    <MagnifyingGlassIcon size={16} color="#9CA3AF" style={{ marginRight: 8 }} />
                    <TextInput
                      ref={searchInputRef}
                      value={searchValue}
                      onChangeText={handleSearchChange}
                      placeholder={searchPlaceholder}
                      placeholderTextColor="#666"
                      style={{
                        flex: 1,
                        color: '#FFFFFF',
                        fontSize: 14,
                        fontFamily: 'Instrument Sans, system-ui, sans-serif',
                        paddingVertical: 0,
                      }}
                      selectionColor="#FF4D00"
                      underlineColorAndroid="transparent"
                    />
                  </View>
                )}
                {loading ? (
                  <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                    <Text
                      className="text-gray-500 text-sm"
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
                      className="text-gray-400 text-sm"
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
                        className="text-gray-500 text-xs mt-1"
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
                    style={{ maxHeight: listMaxHeight }}
                    showsVerticalScrollIndicator
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                    {items.map((item) => {
                      const id = getItemId(item);
                      const { primary, secondary } = getItemLabel(item);
                      const isSelected = value === id;
                      const itemColor = getItemColor ? getItemColor(item) ?? null : null;
                      return (
                        <TouchableOpacity
                          key={id}
                          onPress={() => handleSelect(id, item)}
                          style={rowStyle(isSelected, itemColor)}
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
                              className="text-white font-instrument-medium text-sm"
                              style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
                              numberOfLines={1}
                            >
                              {primary}
                            </Text>
                            {secondary != null && secondary !== '' && (
                              <Text
                                className="text-gray-400 text-xs mt-0.5"
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
            </Pressable>
            );
          })()}
        </Pressable>
      </Modal>
    </View>
  );
}
