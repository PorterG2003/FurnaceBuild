import { useState, useRef, useCallback } from 'react';
import { View, Text, Pressable, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronLeftIcon, ChevronRightIcon, CalendarDaysIcon } from 'react-native-heroicons/outline';
import { PopupPortal } from '@/components/ui/PopupPortal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Min height for the trigger row (align with paired text fields, e.g. OOO modal). */
export const DATE_INPUT_TRIGGER_MIN_HEIGHT = 38;

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

interface CalendarProps {
  value: string;
  min?: string;
  max?: string;
  onSelect: (ymd: string) => void;
  onClose: () => void;
}

function Calendar({ value, min, max, onSelect, onClose }: CalendarProps) {
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

  return (
    <View
      style={{
        backgroundColor: '#1A1A1A',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#2A2A2A',
        padding: 14,
        width: 262,
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      {/* Month navigation header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Pressable
          onPress={prevMonth}
          style={({ pressed, hovered }: any) => ({
            padding: 6,
            borderRadius: 6,
            backgroundColor: pressed || hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
          })}
        >
          <ChevronLeftIcon size={15} color="#9CA3AF" />
        </Pressable>

        <Text style={{
          color: '#F3F4F6',
          fontSize: 13,
          fontFamily: 'InstrumentSans_600SemiBold, Instrument Sans, system-ui',
          fontWeight: '600',
          letterSpacing: 0.2,
        }}>
          {MONTH_NAMES[viewMonth]} {viewYear}
        </Text>

        <Pressable
          onPress={nextMonth}
          style={({ pressed, hovered }: any) => ({
            padding: 6,
            borderRadius: 6,
            backgroundColor: pressed || hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
          })}
        >
          <ChevronRightIcon size={15} color="#9CA3AF" />
        </Pressable>
      </View>

      {/* Day-of-week labels */}
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        {DAY_LABELS.map(label => (
          <View key={label} style={{ flex: 1, alignItems: 'center', paddingVertical: 3 }}>
            <Text style={{
              color: '#4B5563',
              fontSize: 11,
              fontFamily: 'Instrument Sans, system-ui',
              fontWeight: '500',
            }}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      {/* Day cells */}
      {weeks.map((week, wi) => (
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
                  fontSize: 12,
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
  /** Merged onto the calendar trigger `Pressable` after default styles. */
  triggerStyle?: StyleProp<ViewStyle>;
}

export function DateInput({
  value,
  onChange,
  label,
  min,
  max,
  disabled,
  placeholder = 'Pick a date',
  triggerStyle,
}: DateInputProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<View>(null);

  const displayValue = formatDisplay(value);
  const close = useCallback(() => setOpen(false), []);

  const openCalendar = useCallback(() => {
    if (disabled) return;
    setOpen(v => !v);
  }, [disabled]);

  return (
    <View style={{ position: 'relative' }}>
      {label && (
        <Text style={{ color: '#9CA3AF', fontSize: 11, fontFamily: 'Instrument Sans, system-ui', fontWeight: '500', marginBottom: 4 }}>
          {label}
        </Text>
      )}
      <Pressable
        ref={triggerRef}
        onPress={openCalendar}
        disabled={disabled}
        style={({ pressed, hovered }: any) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: open ? '#222' : pressed || hovered ? '#1C1C1C' : '#141414',
            borderWidth: 1,
            borderColor: open ? '#4A4A4A' : '#2E2E2E',
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 7,
            minHeight: DATE_INPUT_TRIGGER_MIN_HEIGHT,
            opacity: disabled ? 0.45 : 1,
            ...(Platform.OS === 'web' ? { cursor: disabled ? 'not-allowed' : 'pointer' } : {}),
          },
          triggerStyle,
        ]}
      >
        <CalendarDaysIcon size={14} color={value ? '#9CA3AF' : '#4B5563'} />
        <Text style={{
          color: value ? '#F3F4F6' : '#4B5563',
          fontSize: 13,
          fontFamily: 'Instrument Sans, system-ui',
        }}>
          {displayValue || placeholder}
        </Text>
      </Pressable>

      <PopupPortal
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        placement="bottom-start"
        gap={6}
      >
        <Calendar
          value={value}
          min={min}
          max={max}
          onSelect={onChange}
          onClose={close}
        />
      </PopupPortal>
    </View>
  );
}
