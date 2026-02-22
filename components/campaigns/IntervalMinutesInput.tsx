import { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, TextInput, Platform } from 'react-native';
import { ChevronDownIcon, ChevronUpIcon } from 'react-native-heroicons/outline';
import { calculateEmailsPerMailboxPerDay, type ScheduleShape } from '@/lib/campaigns/utils';

const MIN_MINUTES = 1;

export interface IntervalMinutesInputProps {
  value: number;
  onChange: (minutes: number) => void;
  schedule?: ScheduleShape | null;
}

export function IntervalMinutesInput({ value, onChange, schedule }: IntervalMinutesInputProps) {
  const [inputStr, setInputStr] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const focusedInputRef = useRef<HTMLInputElement | null>(null);

  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement !== focusedInputRef.current) return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const next = Math.max(MIN_MINUTES, valueRef.current + 1);
        valueRef.current = next;
        onChangeRef.current(next);
        setInputStr(null);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        const next = Math.max(MIN_MINUTES, valueRef.current - 1);
        valueRef.current = next;
        onChangeRef.current(next);
        setInputStr(null);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => {
      document.removeEventListener('keydown', handler, true);
      focusedInputRef.current = null;
    };
  }, []);

  const displayValue = inputStr !== null ? inputStr : String(value);
  const setMinutes = (mins: number) => onChange(Math.max(MIN_MINUTES, mins));

  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 8,
          alignSelf: 'flex-start',
          paddingRight: 8,
          paddingLeft: 0,
          ...(Platform.OS === 'web' ? { userSelect: 'none' as const } : {}),
        }}
      >
        <TextInput
          ref={inputRef}
          value={displayValue}
          onChangeText={(t) => {
            setInputStr(t);
            const n = parseInt(t, 10);
            if (!isNaN(n) && n >= MIN_MINUTES) onChange(n);
          }}
          onFocus={(e: any) => {
            if (Platform.OS === 'web' && e?.nativeEvent?.target) {
              focusedInputRef.current = e.nativeEvent.target as HTMLInputElement;
            }
          }}
          onBlur={() => {
            if (Platform.OS === 'web') focusedInputRef.current = null;
            if (inputStr !== null) {
              const n = parseInt(inputStr, 10);
              if (isNaN(n) || n < MIN_MINUTES) setMinutes(MIN_MINUTES);
            }
            setInputStr(null);
          }}
          keyboardType="number-pad"
          placeholder="5"
          placeholderTextColor="#6b7280"
          className="text-white font-instrument text-base text-center"
          style={{
            width: 24,
            marginHorizontal: 2,
            paddingVertical: 6,
            paddingHorizontal: 0,
          }}
        />
        <Text className="text-gray-400 font-instrument text-sm" style={{ marginLeft: 0, marginRight: 8 }}>
          minutes
        </Text>
        <View
          style={{
            width: 24,
            height: 36,
            flexDirection: 'column',
            marginVertical: 4,
            borderRadius: 6,
            backgroundColor: '#2A2A2A',
            overflow: 'hidden',
          }}
          {...(Platform.OS === 'web' ? { onMouseDown: (e: any) => e.preventDefault?.() } : {})}
        >
          <Pressable
            onPress={() => setMinutes(value + 1)}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderBottomWidth: 1,
              borderBottomColor: '#3A3A3A',
            }}
          >
            <ChevronUpIcon size={12} color="#9CA3AF" />
          </Pressable>
          <Pressable
            onPress={() => setMinutes(value - 1)}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            disabled={value <= MIN_MINUTES}
          >
            <ChevronDownIcon size={12} color={value <= MIN_MINUTES ? '#4B5563' : '#9CA3AF'} />
          </Pressable>
        </View>
      </View>
      <Text className="text-gray-500 font-instrument text-xs mt-2">
        {calculateEmailsPerMailboxPerDay(schedule ?? null, value)}
      </Text>
    </View>
  );
}
