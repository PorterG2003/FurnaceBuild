import { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { View, Text, Pressable, Platform, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronLeftIcon, ChevronRightIcon, CalendarDaysIcon, XMarkIcon } from 'react-native-heroicons/outline';
import { PopupPortal } from '@/components/ui/PopupPortal';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { BottomSheet, useBottomSheetTakeover, usePickerInsideBottomSheet } from '@/components/ui/modals';
import { FORM_FIELD_VARIANTS, type FormFieldVariant } from '@/components/ui/forms/formFieldStyles';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Max week rows for any month (e.g. 31 days starting Saturday). Sheet layout pads to this so height is stable. */
const SHEET_CALENDAR_WEEK_ROWS = 6;

/** Min height for the trigger row; matches compact `Select` / `SearchAndSelectMulti` triggers. */
export const DATE_INPUT_TRIGGER_MIN_HEIGHT = 32;

function parseYMD(value: string): { year: number; month: number; day: number } | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { year: y, month: m - 1, day: d };
}

function toYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatDisplay(value: string): string {
  const p = parseYMD(value);
  if (!p) return '';
  const d = new Date(p.year, p.month, p.day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

// ---------------------------------------------------------------------------
// Calendar popup content
// ---------------------------------------------------------------------------

type CalendarLayout = 'popover' | 'sheet';

interface CalendarProps {
  value: string;
  min?: string;
  max?: string;
  onSelect: (ymd: string) => void;
  onClose: () => void;
  /** `popover` — fixed width anchored panel; `sheet` — full width inside BottomSheet / takeover. */
  layout?: CalendarLayout;
}

function Calendar({ value, min, max, onSelect, onClose, layout = 'popover' }: CalendarProps) {
  const today = new Date();
  const parsed = parseYMD(value);
  const [viewYear, setViewYear] = useState(parsed?.year ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.getMonth());

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDow = getFirstDayOfWeek(viewYear, viewMonth);

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isDisabled = (day: number) => {
    const ymd = toYMD(viewYear, viewMonth, day);
    if (min && ymd < min) return true;
    if (max && ymd > max) return true;
    return false;
  };

  const isSelected = (day: number) => value === toYMD(viewYear, viewMonth, day);
  const isToday = (day: number) =>
    today.getFullYear() === viewYear &&
    today.getMonth() === viewMonth &&
    today.getDate() === day;

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const handleSelect = (day: number) => {
    if (!day || isDisabled(day)) return;
    onSelect(toYMD(viewYear, viewMonth, day));
    onClose();
  };

  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  const isSheet = layout === 'sheet';
  const emptyWeek = (): (number | null)[] => Array(7).fill(null);
  const weeksForLayout = isSheet
    ? (() => {
        const w = [...weeks];
        while (w.length < SHEET_CALENDAR_WEEK_ROWS) w.push(emptyWeek());
        return w;
      })()
    : weeks;
  const navPad = isSheet ? 10 : 6;
  const monthTitleSize = isSheet ? 15 : 13;
  const chevronSize = isSheet ? 18 : 15;
  const dowFontSize = isSheet ? 12 : 11;
  const dayFontSize = isSheet ? 14 : 12;

  /** Sheet hosts (`BottomSheet`, takeover) already use `#1A1A1A` + horizontal padding — stay flush, no inner card. */
  const containerStyle = isSheet
    ? {
        backgroundColor: 'transparent',
        width: '100%' as const,
        alignSelf: 'stretch' as const,
        padding: 0,
      }
    : {
        backgroundColor: '#1A1A1A' as const,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#2A2A2A',
        padding: 14,
        width: 262,
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
      };

  return (
    <View style={containerStyle}>
      {/* Month navigation header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: isSheet ? 8 : 10,
        }}
      >
        <Pressable
          onPress={prevMonth}
          style={({ pressed, hovered }: any) => ({
            padding: navPad,
            borderRadius: 6,
            minWidth: isSheet ? 44 : undefined,
            minHeight: isSheet ? 44 : undefined,
            alignItems: 'center' as const,
            justifyContent: 'center' as const,
            backgroundColor: pressed || hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
          })}
        >
          <ChevronLeftIcon size={chevronSize} color="#9CA3AF" />
        </Pressable>

        <Text style={{
          color: '#F3F4F6',
          fontSize: monthTitleSize,
          fontFamily: 'InstrumentSans_600SemiBold, Instrument Sans, system-ui',
          fontWeight: '600',
          letterSpacing: 0.2,
        }}>
          {MONTH_NAMES[viewMonth]} {viewYear}
        </Text>

        <Pressable
          onPress={nextMonth}
          style={({ pressed, hovered }: any) => ({
            padding: navPad,
            borderRadius: 6,
            minWidth: isSheet ? 44 : undefined,
            minHeight: isSheet ? 44 : undefined,
            alignItems: 'center' as const,
            justifyContent: 'center' as const,
            backgroundColor: pressed || hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
          })}
        >
          <ChevronRightIcon size={chevronSize} color="#9CA3AF" />
        </Pressable>
      </View>

      {/* Day-of-week labels */}
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        {DAY_LABELS.map(label => (
          <View key={label} style={{ flex: 1, alignItems: 'center', paddingVertical: isSheet ? 4 : 3 }}>
            <Text style={{
              color: '#4B5563',
              fontSize: dowFontSize,
              fontFamily: 'Instrument Sans, system-ui',
              fontWeight: '500',
            }}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      {/* Day cells */}
      {weeksForLayout.map((week, wi) => (
        <View key={wi} style={{ flexDirection: 'row', marginBottom: 2 }}>
          {week.map((day, di) => {
            if (!day) return <View key={di} style={{ flex: 1, aspectRatio: 1 }} />;
            const sel = isSelected(day);
            const dis = isDisabled(day);
            const tod = isToday(day);
            return (
              <Pressable
                key={di}
                onPress={() => handleSelect(day)}
                disabled={dis}
                style={({ pressed, hovered }: any) => ({
                  flex: 1,
                  aspectRatio: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  backgroundColor: sel
                    ? '#F3440D'
                    : pressed || hovered
                      ? 'rgba(255,255,255,0.07)'
                      : 'transparent',
                  opacity: dis ? 0.28 : 1,
                })}
              >
                <Text style={{
                  color: sel ? '#FFFFFF' : tod ? '#F3440D' : '#D1D5DB',
                  fontSize: dayFontSize,
                  fontFamily: 'Instrument Sans, system-ui',
                  fontWeight: sel || tod ? '600' : '400',
                }}>
                  {day}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// DateInput
// ---------------------------------------------------------------------------

interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  /** `comfortable` matches default Select / sheet row tap targets (~44pt). */
  triggerSize?: 'compact' | 'comfortable';
  /** Merged onto the calendar trigger `Pressable` after default styles. */
  triggerStyle?: StyleProp<ViewStyle>;
  /** Matches `Select` / `FormTextField`. Default `glass` for toolbars. */
  variant?: FormFieldVariant;
  /** When set, an X appears on the right while the field has a value and is not disabled. */
  onClear?: () => void;
}

export function DateInput({
  value,
  onChange,
  label,
  min,
  max,
  disabled,
  placeholder = 'Pick a date',
  triggerSize = 'compact',
  triggerStyle,
  variant = 'glass',
  onClear,
}: DateInputProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isCompactLayout = screenWidth < LAYOUT_BREAKPOINT;
  /** Calendar + padding; cap like `Select` so the sheet does not dominate very short viewports. */
  const sheetBodyMaxHeight = Math.min(420, screenHeight * 0.55);
  const insideSheet = usePickerInsideBottomSheet();
  const { presentTakeover, dismissTakeover } = useBottomSheetTakeover();
  const [open, setOpen] = useState(false);
  const [triggerHovered, setTriggerHovered] = useState(false);
  const triggerRef = useRef<View>(null);

  const displayValue = formatDisplay(value);
  const close = useCallback(() => setOpen(false), []);
  const comfortableTrigger = triggerSize === 'comfortable';
  const fieldVariant = FORM_FIELD_VARIANTS[variant];
  const triggerBorderRadius = comfortableTrigger
    ? fieldVariant.triggerBorderRadius.default
    : fieldVariant.triggerBorderRadius.compact;

  const openCalendar = useCallback(() => {
    if (disabled) return;
    setOpen(v => !v);
  }, [disabled]);

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
      title: insideSheet ? null : (label ?? placeholder) || 'Date',
      content: (
        <View style={{ alignSelf: 'stretch', width: '100%' }}>
          <Calendar
            layout="sheet"
            value={value}
            min={min}
            max={max}
            onSelect={onChange}
            onClose={close}
          />
        </View>
      ),
      onRequestDismiss: close,
    });
  }, [
    isCompactLayout,
    insideSheet,
    open,
    dismissTakeover,
    presentTakeover,
    label,
    placeholder,
    value,
    min,
    max,
    onChange,
    close,
  ]);

  return (
    <View style={{ position: 'relative' }}>
      {label ? (
        <Text selectable={false} className={fieldVariant.labelClassName}>
          {label}
        </Text>
      ) : null}
      <View
        {...(Platform.OS === 'web'
          ? {
              onMouseEnter: () => setTriggerHovered(true),
              onMouseLeave: () => setTriggerHovered(false),
            }
          : {})}
      >
      <Pressable
        ref={triggerRef}
        onPress={openCalendar}
        disabled={disabled}
        style={({ pressed }: any) => {
          const interacted = pressed || triggerHovered;
          const chrome = fieldVariant.trigger;
          let backgroundColor = chrome.backgroundColor;
          let borderColor = chrome.borderColor;
          if (variant === 'glass') {
            if (open) {
              backgroundColor = 'rgba(255, 255, 255, 0.16)';
              borderColor = 'rgba(255, 255, 255, 0.32)';
            } else if (interacted) {
              backgroundColor = 'rgba(255, 255, 255, 0.1)';
              borderColor = 'rgba(255, 255, 255, 0.26)';
            }
          } else if (open || interacted) {
            borderColor = '#4A4A4A';
          }
          return [
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: comfortableTrigger ? 8 : 6,
              backgroundColor,
              borderWidth: chrome.borderWidth,
              borderColor,
              borderRadius: triggerBorderRadius,
              paddingHorizontal: comfortableTrigger ? 14 : 10,
              paddingVertical: comfortableTrigger ? 12 : 6,
              minHeight: comfortableTrigger ? 44 : DATE_INPUT_TRIGGER_MIN_HEIGHT,
              opacity: disabled ? 0.45 : 1,
              ...(Platform.OS === 'web' ? { cursor: disabled ? 'not-allowed' : 'pointer' } : {}),
            },
            triggerStyle,
          ];
        }}
      >
        <CalendarDaysIcon
          size={comfortableTrigger ? 18 : 14}
          color={displayValue ? '#9CA3AF' : fieldVariant.triggerPlaceholderColor}
        />
        <Text
          selectable={false}
          className={`${comfortableTrigger ? 'text-sm' : 'text-xs'} font-instrument flex-1`}
          style={{
            color: displayValue ? fieldVariant.triggerTextColor : fieldVariant.triggerPlaceholderColor,
            fontFamily: 'Instrument Sans, system-ui',
          }}
          numberOfLines={1}
        >
          {displayValue || placeholder}
        </Text>
        {onClear && displayValue && !disabled ? (
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              onClear();
              close();
            }}
            hitSlop={8}
            accessibilityLabel="Clear date"
            style={({ pressed, hovered }: any) => ({
              padding: 2,
              borderRadius: 4,
              backgroundColor: pressed || hovered ? 'rgba(255,255,255,0.08)' : 'transparent',
              ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
            })}
          >
            <XMarkIcon size={comfortableTrigger ? 16 : 14} color="#9CA3AF" />
          </Pressable>
        ) : null}
      </Pressable>
      </View>

      {!isCompactLayout ? (
        <PopupPortal
          anchorRef={triggerRef}
          open={open}
          onClose={close}
          placement="bottom-start"
          gap={6}
        >
          <Calendar
            layout="popover"
            value={value}
            min={min}
            max={max}
            onSelect={onChange}
            onClose={close}
          />
        </PopupPortal>
      ) : null}

      {isCompactLayout && !insideSheet ? (
        <BottomSheet visible={open} onClose={close}>
          <View style={{ maxHeight: sheetBodyMaxHeight }}>
            <Calendar
              layout="sheet"
              value={value}
              min={min}
              max={max}
              onSelect={onChange}
              onClose={close}
            />
          </View>
        </BottomSheet>
      ) : null}
    </View>
  );
}
