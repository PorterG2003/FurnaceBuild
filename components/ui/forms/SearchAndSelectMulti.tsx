import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
} from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
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

export interface SearchAndSelectMultiProps<T> {
  items: T[];
  getItemId: (item: T) => string;
  getItemLabel: (item: T) => string;
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  searchPlaceholder?: string;
  placeholder?: string;
  listMaxHeight?: number;
  /** Shown when there are no items. (hasSearch) => string */
  emptyMessage?: (hasSearch: boolean) => string;
  /** Optional: return hex color for item to show a colored dot next to the label */
  getItemColor?: (item: T) => string | null | undefined;
}

export function SearchAndSelectMulti<T>({
  items,
  getItemId,
  getItemLabel,
  value,
  onChange,
  label,
  searchPlaceholder = 'Search…',
  placeholder = 'All',
  listMaxHeight = 200,
  emptyMessage = (hasSearch: boolean) => (hasSearch ? 'No results' : 'No options'),
  getItemColor,
}: SearchAndSelectMultiProps<T>) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isCompactLayout = screenWidth < LAYOUT_BREAKPOINT;
  const insideSheet = usePickerInsideBottomSheet();
  const { presentTakeover, dismissTakeover } = useBottomSheetTakeover();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [triggerLayout, setTriggerLayout] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const triggerRef = useRef<View>(null);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter((item) => getItemLabel(item).toLowerCase().includes(q));
  }, [items, search, getItemLabel]);

  useEffect(() => {
    if (!open) {
      setTriggerLayout(null);
      setSearch('');
      return;
    }
    if (isCompactLayout) {
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

  const displayText = (() => {
    if (value.length === 0) return placeholder;
    if (value.length === 1) {
      const item = items.find((i) => getItemId(i) === value[0]);
      return item ? getItemLabel(item) : '1 selected';
    }
    return `${value.length} selected`;
  })();

  const toggleItem = useCallback(
    (id: string) => {
      if (value.includes(id)) {
        onChange(value.filter((v) => v !== id));
      } else {
        onChange([...value, id]);
      }
    },
    [value, onChange]
  );

  const close = useCallback(() => setOpen(false), []);

  const dropdownContentHeight = listMaxHeight + 100;
  const sheetBodyMaxHeight = Math.min(dropdownContentHeight, screenHeight * 0.55);
  const takeoverListMax = Math.min(listMaxHeight, Math.floor(screenHeight * 0.65));

  const renderListPanel = useCallback(
    (listScrollMax: number = listMaxHeight) => (
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
          value={search}
          onChangeText={setSearch}
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
      {filteredItems.length === 0 ? (
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
            {emptyMessage(search.trim().length > 0)}
          </Text>
          {search.trim().length > 0 && (
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
          style={{ maxHeight: listScrollMax }}
          showsVerticalScrollIndicator
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {filteredItems.map((item) => {
            const id = getItemId(item);
            const isSelected = value.includes(id);
            return (
              <Pressable
                key={id}
                onPress={() => toggleItem(id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  marginBottom: 6,
                  borderWidth: 1,
                  backgroundColor: isSelected ? 'rgba(243, 68, 13, 0.14)' : '#121212',
                  borderColor: isSelected ? 'rgba(243, 68, 13, 0.4)' : '#2A2A2A',
                }}
              >
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    borderWidth: 1,
                    borderColor: isSelected ? '#F3440D' : '#4B5563',
                    backgroundColor: isSelected ? 'rgba(243, 68, 13, 0.3)' : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSelected && <Text className="text-orange-500 text-xs font-bold">✓</Text>}
                </View>
                {getItemColor ? (
                  (() => {
                    const color = getItemColor(item);
                    return color ? (
                      <View
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 6,
                          backgroundColor: color,
                          borderWidth: 1,
                          borderColor: '#3A3A3A',
                        }}
                      />
                    ) : null;
                  })()
                ) : null}
                <Text className="text-white font-instrument-medium text-sm flex-1" numberOfLines={1}>
                  {getItemLabel(item)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
    ),
    [
      search,
      searchPlaceholder,
      filteredItems,
      emptyMessage,
      value,
      getItemId,
      getItemLabel,
      getItemColor,
      toggleItem,
      listMaxHeight,
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
      onRequestDismiss: close,
    });
  }, [
    isCompactLayout,
    insideSheet,
    open,
    dismissTakeover,
    presentTakeover,
    label,
    close,
    renderListPanel,
    takeoverListMax,
  ]);

  return (
    <View style={{ marginBottom: 12 }}>
      {label != null && (
        <Text className="text-xs font-instrument-medium mb-2 text-gray-400">{label}</Text>
      )}
      <Pressable
        ref={triggerRef}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: 44,
          borderWidth: 1,
          borderColor: '#FFFFFF4D',
          backgroundColor: '#FFFFFF0D',
        }}
      >
        <Text
          className="text-sm font-instrument flex-1"
          style={{ color: value.length > 0 ? '#FFFFFF' : '#666666' }}
          numberOfLines={1}
        >
          {displayText}
        </Text>
        <ChevronDownIcon size={18} color="#9CA3AF" />
      </Pressable>

      {isCompactLayout ? (
        insideSheet ? null : (
          <BottomSheet visible={open} onClose={close}>
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
        <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
          <Pressable style={{ flex: 1 }} onPress={close}>
            {triggerLayout && (
              <Pressable
                style={{
                  position: 'absolute',
                  left: triggerLayout.x,
                  top: triggerLayout.y + triggerLayout.h + 4,
                  width: Math.max(triggerLayout.w, 260),
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
            )}
          </Pressable>
        </Modal>
      )}
    </View>
  );
}
