import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
  Platform,
} from 'react-native';
import { ChevronDownIcon, MagnifyingGlassIcon } from 'react-native-heroicons/outline';

export interface SearchAndSelectProps<T> {
  items: T[];
  getItemId: (item: T) => string;
  getItemLabel: (item: T) => { primary: string; secondary?: string };
  value: string | null;
  onChange: (id: string, item: T | null) => void;
  onSearchChange: (search: string) => void;
  loading?: boolean;
  label?: string;
  searchPlaceholder?: string;
  /** When provided, search input is controlled by parent. */
  searchValue?: string;
  /** Shown in closed state when nothing selected. */
  placeholder?: string;
  emptyMessage?: (hasSearch: boolean) => string;
  listMaxHeight?: number;
  loadingMessage?: string;
}

const defaultEmptyMessage = (hasSearch: boolean) =>
  hasSearch ? 'No results.' : 'No items.';

const triggerStyle = {
  borderColor: '#FFFFFF4D',
  backgroundColor: '#FFFFFF0D',
  borderWidth: 1,
};

export function SearchAndSelect<T>({
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
}: SearchAndSelectProps<T>) {
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
      onSearchChange(text);
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

  // Focus search when popover opens
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [open]);

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

  const selectedLabel = (() => {
    if (value == null) return null;
    const item = items.find((i) => getItemId(i) === value);
    if (item) return getItemLabel(item).primary;
    return null;
  })();

  const displayText = selectedLabel ?? placeholder;

  const rowStyle = (isSelected: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 6,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    ...(isSelected
      ? { backgroundColor: 'rgba(243, 68, 13, 0.14)', borderColor: 'rgba(243, 68, 13, 0.4)' }
      : { backgroundColor: '#121212', borderColor: '#2A2A2A' }),
  });

  return (
    <View style={{ marginBottom: 12 }}>
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
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            minHeight: 44,
          },
        ]}
      >
        <Text
          className="text-sm text-white"
          style={{
            fontFamily: 'Instrument Sans, system-ui, sans-serif',
            flex: 1,
            color: selectedLabel ? '#FFFFFF' : '#666666',
          }}
          numberOfLines={1}
        >
          {displayText}
        </Text>
        <ChevronDownIcon size={18} color="#9CA3AF" />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={closePopover}
      >
        <Pressable style={{ flex: 1 }} onPress={closePopover}>
          {triggerLayout && (
            <Pressable
              style={{
                position: 'absolute',
                left: triggerLayout.x,
                top: triggerLayout.y + triggerLayout.h + 4,
                width: triggerLayout.w,
                maxHeight: listMaxHeight + 120,
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
                {loading ? (
                  <Text
                    className="text-gray-500 text-sm"
                    style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif', paddingVertical: 8 }}
                  >
                    {loadingMessage}
                  </Text>
                ) : items.length === 0 ? (
                  <Text
                    className="text-gray-500 text-sm"
                    style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif', paddingVertical: 8 }}
                  >
                    {emptyMessage(searchValue.trim().length > 0)}
                  </Text>
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
                      return (
                        <TouchableOpacity
                          key={id}
                          onPress={() => handleSelect(id, item)}
                          style={rowStyle(isSelected)}
                        >
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
          )}
        </Pressable>
      </Modal>
    </View>
  );
}
