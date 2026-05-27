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
import { PopupPortal } from '@/components/ui/PopupPortal';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { FormFieldLabel } from './FormFieldHelp';
import { FORM_FIELD_VARIANTS, type FormFieldVariant } from './formFieldStyles';
import {
  FORM_DROPDOWN_POPUP_GAP,
  getFormDropdownPanelStyle,
} from './formDropdownPopup';

const noSelectStyle = Platform.OS === 'web' ? ({ userSelect: 'none' } as const) : undefined;
const textInputWebStyle = Platform.OS === 'web' ? ({ userSelect: 'text' } as const) : undefined;

/** Stable references — `renderListPanel` depends on `panelSizing`; inline objects each render caused infinite `useLayoutEffect` → `presentTakeover` loops inside `BottomSheet`. */
const TRIGGER_SIZING = {
  compact: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
    textClassName: 'text-xs',
    chevronSize: 14,
  },
  default: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
    textClassName: 'text-sm',
    chevronSize: 18,
  },
} as const;

const PANEL_SIZING = {
  compact: {
    panelPadding: 8,
    searchRadius: 8,
    searchPaddingX: 8,
    searchPaddingY: 6,
    searchMarginBottom: 6,
    searchIconSize: 14,
    searchTextSize: 12,
    rowGap: 8,
    rowPaddingY: 7,
    rowPaddingX: 10,
    rowRadius: 8,
    rowMarginBottom: 4,
    checkboxSize: 16,
    checkboxRadius: 4,
    rowTextClassName: 'text-xs',
  },
  default: {
    panelPadding: 10,
    searchRadius: 10,
    searchPaddingX: 10,
    searchPaddingY: 8,
    searchMarginBottom: 8,
    searchIconSize: 16,
    searchTextSize: 14,
    rowGap: 10,
    rowPaddingY: 10,
    rowPaddingX: 12,
    rowRadius: 12,
    rowMarginBottom: 6,
    checkboxSize: 18,
    checkboxRadius: 4,
    rowTextClassName: 'text-sm',
  },
} as const;

export interface SearchAndSelectMultiProps<T> {
  items: T[];
  getItemId: (item: T) => string;
  getItemLabel: (item: T) => string;
  /** Optional muted sublabel (e.g. status) shown below the primary label in the list. */
  getItemSecondaryLabel?: (item: T) => string | null | undefined;
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  /** Short explanation shown via help icon next to the label. */
  labelHelp?: string;
  searchPlaceholder?: string;
  placeholder?: string;
  listMaxHeight?: number;
  /** Shown when there are no items. (hasSearch) => string */
  emptyMessage?: (hasSearch: boolean) => string;
  /** Optional: return hex color for item to show a colored dot next to the label */
  getItemColor?: (item: T) => string | null | undefined;
  noMargin?: boolean;
  size?: 'default' | 'compact';
  panelSize?: 'default' | 'compact';
  /** Matches `FormTextField` / modal inputs when `solid`. Default `glass` for toolbars. */
  variant?: FormFieldVariant;
}

export function SearchAndSelectMulti<T>({
  items,
  getItemId,
  getItemLabel,
  getItemSecondaryLabel,
  value,
  onChange,
  label,
  labelHelp,
  searchPlaceholder = 'Search…',
  placeholder = 'All',
  listMaxHeight = 200,
  emptyMessage = (hasSearch: boolean) => (hasSearch ? 'No results' : 'No options'),
  getItemColor,
  noMargin = false,
  size = 'default',
  panelSize = size,
  variant = 'glass',
}: SearchAndSelectMultiProps<T>) {
  const fieldVariant = FORM_FIELD_VARIANTS[variant];
  const triggerSizing = size === 'compact' ? TRIGGER_SIZING.compact : TRIGGER_SIZING.default;
  const triggerBorderRadius =
    size === 'compact'
      ? fieldVariant.triggerBorderRadius.compact
      : fieldVariant.triggerBorderRadius.default;
  const panelSizing = panelSize === 'compact' ? PANEL_SIZING.compact : PANEL_SIZING.default;

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isCompactLayout = screenWidth < LAYOUT_BREAKPOINT;
  const insideSheet = usePickerInsideBottomSheet();
  const { presentTakeover, dismissTakeover } = useBottomSheetTakeover();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<View>(null);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const primary = getItemLabel(item).toLowerCase();
      const secondary = getItemSecondaryLabel?.(item)?.toLowerCase() ?? '';
      return primary.includes(q) || secondary.includes(q);
    });
  }, [items, search, getItemLabel, getItemSecondaryLabel]);

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

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
  const dropdownPanelStyle = getFormDropdownPanelStyle({ maxHeight: dropdownContentHeight });

  const renderListPanel = useCallback(
    (listScrollMax: number = listMaxHeight) => (
    <View style={{ padding: panelSizing.panelPadding, ...noSelectStyle }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: fieldVariant.panelSearch.backgroundColor,
          borderRadius: fieldVariant.panelSearchBorderRadius,
          borderWidth: 1,
          borderColor: fieldVariant.panelSearch.borderColor,
          paddingHorizontal: panelSizing.searchPaddingX,
          paddingVertical: panelSizing.searchPaddingY,
          marginBottom: panelSizing.searchMarginBottom,
          ...noSelectStyle,
        }}
      >
        <MagnifyingGlassIcon size={panelSizing.searchIconSize} color="#9CA3AF" style={{ marginRight: 8 }} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={searchPlaceholder}
          placeholderTextColor="#666"
          style={{
            flex: 1,
            color: '#FFFFFF',
            fontSize: panelSizing.searchTextSize,
            fontFamily: 'Instrument Sans, system-ui, sans-serif',
            paddingVertical: 0,
            ...textInputWebStyle,
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
            selectable={false}
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
              selectable={false}
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
            const secondaryLabel = getItemSecondaryLabel?.(item);
            return (
              <Pressable
                key={id}
                onPress={() => toggleItem(id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: panelSizing.rowGap,
                  paddingVertical: panelSizing.rowPaddingY,
                  paddingHorizontal: panelSizing.rowPaddingX,
                  borderRadius: panelSizing.rowRadius,
                  marginBottom: panelSizing.rowMarginBottom,
                  borderWidth: 1,
                  backgroundColor: isSelected ? 'rgba(243, 68, 13, 0.14)' : '#121212',
                  borderColor: isSelected ? 'rgba(243, 68, 13, 0.4)' : '#2A2A2A',
                  ...noSelectStyle,
                }}
              >
                <View
                  style={{
                    width: panelSizing.checkboxSize,
                    height: panelSizing.checkboxSize,
                    borderRadius: panelSizing.checkboxRadius,
                    borderWidth: 1,
                    borderColor: isSelected ? '#F3440D' : '#4B5563',
                    backgroundColor: isSelected ? 'rgba(243, 68, 13, 0.3)' : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSelected && <Text selectable={false} className="text-orange-500 text-xs font-bold">✓</Text>}
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
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    selectable={false}
                    className={`text-white font-instrument-medium ${panelSizing.rowTextClassName}`}
                    numberOfLines={1}
                  >
                    {getItemLabel(item)}
                  </Text>
                  {secondaryLabel ? (
                    <Text
                      selectable={false}
                      className="text-gray-400 font-instrument mt-0.5 text-[11px]"
                      numberOfLines={1}
                    >
                      {secondaryLabel}
                    </Text>
                  ) : null}
                </View>
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
      getItemSecondaryLabel,
      getItemColor,
      toggleItem,
      listMaxHeight,
      panelSizing,
      fieldVariant,
      triggerBorderRadius,
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
    <View style={{ marginBottom: noMargin ? 0 : 12 }}>
      {label != null && (
        <FormFieldLabel
          label={label}
          labelClassName={fieldVariant.labelClassName}
          help={labelHelp}
        />
      )}
      <Pressable
        ref={triggerRef}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderRadius: triggerBorderRadius,
          paddingHorizontal: triggerSizing.paddingHorizontal,
          paddingVertical: triggerSizing.paddingVertical,
          minHeight: triggerSizing.minHeight,
          ...fieldVariant.trigger,
          ...noSelectStyle,
        }}
      >
        <Text
          selectable={false}
          className={`${triggerSizing.textClassName} font-instrument flex-1`}
          style={{
            color: value.length > 0
              ? fieldVariant.triggerTextColor
              : fieldVariant.triggerPlaceholderColor,
          }}
          numberOfLines={1}
        >
          {displayText}
        </Text>
        <ChevronDownIcon size={triggerSizing.chevronSize} color="#9CA3AF" />
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
        <PopupPortal
          anchorRef={triggerRef}
          open={open}
          onClose={close}
          placement="bottom-start"
          gap={FORM_DROPDOWN_POPUP_GAP}
          sameWidth
        >
          <View style={dropdownPanelStyle}>{renderListPanel(listMaxHeight)}</View>
        </PopupPortal>
      )}
    </View>
  );
}
