import { View, Text, Pressable, TextInput, ScrollView, Platform } from 'react-native';
import { useState, useRef, useEffect } from 'react';
import type { ScheduleConfig, SchedulePreset } from '../types';
import { applySchedulePreset } from '../utils';
import { ChevronDownIcon, ChevronUpIcon } from 'react-native-heroicons/outline';

interface ScheduleConfigurationStepProps {
  schedule: ScheduleConfig;
  onScheduleChange: (schedule: ScheduleConfig) => void;
  onBack: () => void;
  onNext: () => void;
}

const SCHEDULE_PRESETS: { value: SchedulePreset; label: string }[] = [
  { value: '24/7', label: '24/7 (No Restrictions)' },
  { value: 'business-hours', label: 'Business Hours (9-5 Mon-Fri)' },
  { value: 'weekdays-only', label: 'Weekdays Only (24/7 Mon-Fri)' },
];

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
] as const;

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona Time (MST)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'America/Toronto', label: 'Toronto (ET)' },
  { value: 'America/Vancouver', label: 'Vancouver (PT)' },
  { value: 'America/Mexico_City', label: 'Mexico City (CST)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (BRT)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)' },
  { value: 'Asia/Mumbai', label: 'Mumbai (IST)' },
] as const;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export function ScheduleConfigurationStep({
  schedule,
  onScheduleChange,
  onBack,
  onNext,
}: ScheduleConfigurationStepProps) {
  const handlePresetClick = (preset: SchedulePreset) => {
    onScheduleChange(applySchedulePreset(preset));
  };

  const updateTimezone = (timezone: string) => {
    onScheduleChange({ ...schedule, timezone });
  };

  const updateStartHour = (hour: string) => {
    const num = parseInt(hour);
    if (!isNaN(num) && num >= 0 && num <= 23) {
      onScheduleChange({ ...schedule, start_hour: num });
    }
  };

  const updateStartMinute = (minute: string) => {
    const num = parseInt(minute);
    if (!isNaN(num) && MINUTES.includes(num)) {
      onScheduleChange({ ...schedule, start_minute: num });
    }
  };

  const updateEndHour = (hour: string) => {
    const num = parseInt(hour);
    if (!isNaN(num) && num >= 0 && num <= 23) {
      onScheduleChange({ ...schedule, end_hour: num });
    }
  };

  const updateEndMinute = (minute: string) => {
    const num = parseInt(minute);
    if (!isNaN(num) && MINUTES.includes(num)) {
      onScheduleChange({ ...schedule, end_minute: num });
    }
  };

  const toggleDay = (dayValue: number) => {
    if (schedule.days_of_week.includes(dayValue)) {
      onScheduleChange({
        ...schedule,
        days_of_week: schedule.days_of_week.filter(d => d !== dayValue),
      });
    } else {
      onScheduleChange({
        ...schedule,
        days_of_week: [...schedule.days_of_week, dayValue].sort(),
      });
    }
  };

  const intervalInputRef = useRef<any>(null);

  // Convert seconds to minutes for display
  const getIntervalMinutes = (seconds: number): number => {
    return Math.floor(seconds / 60);
  };

  const [intervalDisplayValue, setIntervalDisplayValue] = useState<string>(
    schedule.sending_interval_seconds > 0 ? getIntervalMinutes(schedule.sending_interval_seconds).toString() : ''
  );

  // Sync display value when schedule changes externally (e.g., from presets)
  useEffect(() => {
    if (schedule.sending_interval_seconds > 0) {
      setIntervalDisplayValue(getIntervalMinutes(schedule.sending_interval_seconds).toString());
    }
  }, [schedule.sending_interval_seconds]);

  const updateSendingInterval = (value: string) => {
    // Update display value immediately
    setIntervalDisplayValue(value);
    
    // Allow empty string to clear the field
    if (value === '' || value === '-') {
      // Store as 0 temporarily - will be validated on submit
      onScheduleChange({ ...schedule, sending_interval_seconds: 0 });
      return;
    }
    const minutes = parseInt(value);
    if (!isNaN(minutes) && minutes >= 0) {
      // Convert minutes to seconds for storage (allow 0 temporarily)
      onScheduleChange({ ...schedule, sending_interval_seconds: minutes * 60 });
    }
  };

  const adjustInterval = (delta: number) => {
    // Use current display value if it's a valid number, otherwise use the schedule value
    const currentDisplay = parseInt(intervalDisplayValue);
    const currentMinutes = !isNaN(currentDisplay) && currentDisplay > 0 
      ? currentDisplay 
      : getIntervalMinutes(schedule.sending_interval_seconds) || 5;
    const newMinutes = Math.max(1, currentMinutes + delta);
    setIntervalDisplayValue(newMinutes.toString());
    onScheduleChange({ ...schedule, sending_interval_seconds: newMinutes * 60 });
  };

  const handleIntervalKeyDown = (e: any) => {
    if (Platform.OS === 'web') {
      const key = e.key || e.nativeEvent?.key;
      if (key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        adjustInterval(1);
        return false;
      } else if (key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        adjustInterval(-1);
        return false;
      }
    }
  };

  // Calculate emails per day per inbox based on schedule and interval
  const calculateEmailsPerDay = (): string => {
    const intervalMinutes = getIntervalMinutes(schedule.sending_interval_seconds);
    if (!intervalMinutes || intervalMinutes <= 0) {
      return '—';
    }

    // Calculate window duration in minutes
    const startTimeMinutes = schedule.start_hour * 60 + schedule.start_minute;
    const endTimeMinutes = schedule.end_hour * 60 + schedule.end_minute;
    
    let windowMinutes: number;
    
    // Special case: if it looks like 24/7 (start=0:00, end=23:59, all days)
    if (startTimeMinutes === 0 && endTimeMinutes >= 1439 && schedule.days_of_week.length === 7) {
      windowMinutes = 24 * 60;
    } else if (endTimeMinutes > startTimeMinutes) {
      // Normal case: start < end (e.g., 9 AM - 5 PM)
      windowMinutes = endTimeMinutes - startTimeMinutes;
    } else if (endTimeMinutes < startTimeMinutes) {
      // Wraps midnight (e.g., 10 PM - 2 AM)
      windowMinutes = (24 * 60 - startTimeMinutes) + endTimeMinutes;
    } else {
      // Same start and end time
      // Check if it's 24/7 by checking if days_of_week includes all days
      if (schedule.days_of_week.length === 7) {
        windowMinutes = 24 * 60; // Full day
      } else {
        // Zero duration window
        windowMinutes = 0;
      }
    }

    if (windowMinutes === 0) {
      return '0';
    }

    // Calculate intervals per window
    const intervalsPerWindow = Math.floor(windowMinutes / intervalMinutes);
    
    // Calculate emails per scheduled day
    const emailsPerScheduledDay = intervalsPerWindow;
    
    // Calculate average per calendar day (considering days of week)
    const scheduledDaysPerWeek = schedule.days_of_week.length;
    const averageEmailsPerDay = Math.round((emailsPerScheduledDay * scheduledDaysPerWeek) / 7 * 100) / 100;

    // Show per scheduled day, and average per calendar day
    if (scheduledDaysPerWeek === 7) {
      return `${emailsPerScheduledDay} per day`;
    } else {
      return `${emailsPerScheduledDay} per scheduled day (avg ${averageEmailsPerDay.toFixed(1)} per calendar day)`;
    }
  };

  return (
    <ScrollView>
      <View>
        <Text className="text-lg font-instrument-semibold text-white mb-4">
          Step 3: Configure Schedule
        </Text>

        <Text className="text-gray-400 font-instrument text-sm mb-6">
          Define when the campaign can send emails. Schedule restrictions apply to all email nodes in the flow.
        </Text>

        {/* Schedule Presets */}
        <View className="mb-6">
          <Text className="text-gray-300 font-instrument-medium text-sm mb-3">Quick Presets</Text>
          <View className="flex-row gap-3">
            {SCHEDULE_PRESETS.map((preset) => (
              <Pressable
                key={preset.value}
                onPress={() => handlePresetClick(preset.value)}
                className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2"
                accessibilityRole="button"
                accessibilityLabel={`Apply ${preset.label} preset`}
              >
                <Text className="text-gray-300 font-instrument text-xs text-center">
                  {preset.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Sending Interval - Prominent Section */}
        <View className="bg-[#121212] rounded-lg p-4 mb-6 border border-[#2A2A2A]">
          <Text className="text-white font-instrument-semibold text-sm mb-1">
            Sending Interval
          </Text>
          <Text className="text-gray-400 font-instrument text-xs mb-4">
            Time between sends per mailbox
          </Text>
          
          <View 
            className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg flex-row items-center"
            style={{
              padding: Platform.OS === 'web' ? 0 : 12,
            }}
          >
            {/* Minus button */}
            <Pressable
              onPress={() => adjustInterval(-1)}
              style={{
                padding: Platform.OS === 'web' ? 12 : 8,
                cursor: Platform.OS === 'web' ? 'pointer' : undefined,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              accessibilityRole="button"
              accessibilityLabel="Decrease interval"
            >
              <ChevronDownIcon size={20} color="#9CA3AF" />
            </Pressable>

            {/* Input and label container */}
            <View 
              className="flex-1 flex-row items-center justify-center gap-2"
              style={{
                paddingVertical: Platform.OS === 'web' ? 12 : 0,
              }}
            >
              {Platform.OS === 'web' ? (
                <>
                  <input
                    ref={intervalInputRef}
                    type="number"
                    value={intervalDisplayValue}
                    onChange={(e) => updateSendingInterval(e.target.value)}
                    onKeyDown={(e) => {
                      const key = e.key;
                      if (key === 'ArrowUp') {
                        e.preventDefault();
                        adjustInterval(1);
                      } else if (key === 'ArrowDown') {
                        e.preventDefault();
                        adjustInterval(-1);
                      }
                    }}
                    placeholder="5"
                    min="1"
                    style={{
                      width: 50,
                      backgroundColor: 'transparent',
                      border: 'none',
                      color: '#FFFFFF',
                      fontSize: 16,
                      fontWeight: 500,
                      textAlign: 'center',
                      fontFamily: 'Instrument Sans, system-ui, sans-serif',
                      outline: 'none',
                      WebkitAppearance: 'none',
                      MozAppearance: 'textfield',
                      padding: 0,
                    }}
                    onWheel={(e: any) => e.target.blur()}
                  />
                  <Text 
                    style={{
                      color: '#9CA3AF',
                      fontSize: 14,
                      fontFamily: 'Instrument Sans, system-ui, sans-serif',
                    }}
                  >
                    minutes
                  </Text>
                </>
              ) : (
                <>
                  <TextInput
                    ref={intervalInputRef}
                    value={intervalDisplayValue}
                    onChangeText={updateSendingInterval}
                    keyboardType="numeric"
                    placeholder="5"
                    placeholderTextColor="#6b7280"
                    className="text-white font-instrument text-base text-center"
                    style={{
                      width: 50,
                      padding: 0,
                    }}
                  />
                  <Text className="text-gray-400 font-instrument text-sm">
                    minutes
                  </Text>
                </>
              )}
            </View>

            {/* Plus button */}
            <Pressable
              onPress={() => adjustInterval(1)}
              style={{
                padding: Platform.OS === 'web' ? 12 : 8,
                cursor: Platform.OS === 'web' ? 'pointer' : undefined,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              accessibilityRole="button"
              accessibilityLabel="Increase interval"
            >
              <ChevronUpIcon size={20} color="#9CA3AF" />
            </Pressable>
          </View>

          <View className="mt-4 p-3 bg-[#1A1A1A] rounded-lg border border-[#2A2A2A]">
            <Text className="text-gray-300 font-instrument-medium text-xs mb-1">
              Estimated Volume
            </Text>
            <Text className="text-gray-400 font-instrument text-sm">
              {calculateEmailsPerDay()} emails per inbox
            </Text>
          </View>
          
          <Text className="text-gray-500 font-instrument text-xs mt-3">
            Each mailbox sends one message per interval. With multiple mailboxes, the total sending rate scales proportionally.
            {Platform.OS === 'web' && ' Use ↑/↓ arrows to adjust.'}
          </Text>
        </View>

        {/* Schedule Configuration */}
        <View className="bg-[#121212] rounded-lg p-4 gap-4 mb-6">
          <Text className="text-white font-instrument-semibold text-sm mb-2">
            Schedule Restrictions
          </Text>
          
          <View>
            <Text className="text-gray-400 font-instrument text-xs mb-2">Timezone</Text>
            {Platform.OS === 'web' ? (
              <select
                value={schedule.timezone}
                onChange={(e) => updateTimezone(e.target.value)}
                style={{
                  width: '100%',
                  backgroundColor: '#1A1A1A',
                  borderColor: '#2A2A2A',
                  borderWidth: 1,
                  borderRadius: 8,
                  padding: '8px 12px',
                  color: '#FFFFFF',
                  fontSize: 14,
                  fontFamily: 'Instrument Sans, system-ui, sans-serif',
                  cursor: 'pointer',
                }}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value} style={{ backgroundColor: '#1A1A1A', color: '#FFFFFF' }}>
                    {tz.label}
                  </option>
                ))}
              </select>
            ) : (
              <TextInput
                value={schedule.timezone}
                onChangeText={updateTimezone}
                placeholder="America/New_York"
                placeholderTextColor="#6b7280"
                className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm"
              />
            )}
          </View>

          <View>
            <Text className="text-gray-400 font-instrument text-xs mb-3">Time Window</Text>
            <View className="gap-3">
              <View>
                <Text className="text-gray-500 font-instrument text-xs mb-2">Start Time</Text>
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="text-gray-500 font-instrument text-xs mb-1">Hour</Text>
                    {Platform.OS === 'web' ? (
                      <select
                        value={schedule.start_hour.toString()}
                        onChange={(e) => updateStartHour(e.target.value)}
                        style={{
                          width: '100%',
                          backgroundColor: '#1A1A1A',
                          borderColor: '#2A2A2A',
                          borderWidth: 1,
                          borderRadius: 8,
                          padding: '8px 12px',
                          color: '#FFFFFF',
                          fontSize: 14,
                          fontFamily: 'Instrument Sans, system-ui, sans-serif',
                          cursor: 'pointer',
                        }}
                      >
                        {HOURS.map((hour) => (
                          <option key={hour} value={hour.toString()} style={{ backgroundColor: '#1A1A1A', color: '#FFFFFF' }}>
                            {hour.toString().padStart(2, '0')}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <TextInput
                        value={schedule.start_hour.toString()}
                        onChangeText={(text) => {
                          const num = parseInt(text);
                          if (!isNaN(num) && num >= 0 && num <= 23) {
                            onScheduleChange({ ...schedule, start_hour: num });
                          }
                        }}
                        keyboardType="numeric"
                        placeholder="9"
                        placeholderTextColor="#6b7280"
                        className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm"
                      />
                    )}
                  </View>
                  <View className="flex-1">
                    <Text className="text-gray-500 font-instrument text-xs mb-1">Minute</Text>
                    {Platform.OS === 'web' ? (
                      <select
                        value={schedule.start_minute.toString()}
                        onChange={(e) => updateStartMinute(e.target.value)}
                        style={{
                          width: '100%',
                          backgroundColor: '#1A1A1A',
                          borderColor: '#2A2A2A',
                          borderWidth: 1,
                          borderRadius: 8,
                          padding: '8px 12px',
                          color: '#FFFFFF',
                          fontSize: 14,
                          fontFamily: 'Instrument Sans, system-ui, sans-serif',
                          cursor: 'pointer',
                        }}
                      >
                        {MINUTES.map((minute) => (
                          <option key={minute} value={minute.toString()} style={{ backgroundColor: '#1A1A1A', color: '#FFFFFF' }}>
                            {minute.toString().padStart(2, '0')}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <TextInput
                        value={schedule.start_minute.toString()}
                        onChangeText={(text) => {
                          const num = parseInt(text);
                          if (!isNaN(num) && MINUTES.includes(num)) {
                            onScheduleChange({ ...schedule, start_minute: num });
                          }
                        }}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor="#6b7280"
                        className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm"
                      />
                    )}
                  </View>
                </View>
              </View>
              <View>
                <Text className="text-gray-500 font-instrument text-xs mb-2">End Time</Text>
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="text-gray-500 font-instrument text-xs mb-1">Hour</Text>
                    {Platform.OS === 'web' ? (
                      <select
                        value={schedule.end_hour.toString()}
                        onChange={(e) => updateEndHour(e.target.value)}
                        style={{
                          width: '100%',
                          backgroundColor: '#1A1A1A',
                          borderColor: '#2A2A2A',
                          borderWidth: 1,
                          borderRadius: 8,
                          padding: '8px 12px',
                          color: '#FFFFFF',
                          fontSize: 14,
                          fontFamily: 'Instrument Sans, system-ui, sans-serif',
                          cursor: 'pointer',
                        }}
                      >
                        {HOURS.map((hour) => (
                          <option key={hour} value={hour.toString()} style={{ backgroundColor: '#1A1A1A', color: '#FFFFFF' }}>
                            {hour.toString().padStart(2, '0')}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <TextInput
                        value={schedule.end_hour.toString()}
                        onChangeText={(text) => {
                          const num = parseInt(text);
                          if (!isNaN(num) && num >= 0 && num <= 23) {
                            onScheduleChange({ ...schedule, end_hour: num });
                          }
                        }}
                        keyboardType="numeric"
                        placeholder="17"
                        placeholderTextColor="#6b7280"
                        className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm"
                      />
                    )}
                  </View>
                  <View className="flex-1">
                    <Text className="text-gray-500 font-instrument text-xs mb-1">Minute</Text>
                    {Platform.OS === 'web' ? (
                      <select
                        value={schedule.end_minute.toString()}
                        onChange={(e) => updateEndMinute(e.target.value)}
                        style={{
                          width: '100%',
                          backgroundColor: '#1A1A1A',
                          borderColor: '#2A2A2A',
                          borderWidth: 1,
                          borderRadius: 8,
                          padding: '8px 12px',
                          color: '#FFFFFF',
                          fontSize: 14,
                          fontFamily: 'Instrument Sans, system-ui, sans-serif',
                          cursor: 'pointer',
                        }}
                      >
                        {MINUTES.map((minute) => (
                          <option key={minute} value={minute.toString()} style={{ backgroundColor: '#1A1A1A', color: '#FFFFFF' }}>
                            {minute.toString().padStart(2, '0')}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <TextInput
                        value={schedule.end_minute.toString()}
                        onChangeText={(text) => {
                          const num = parseInt(text);
                          if (!isNaN(num) && MINUTES.includes(num)) {
                            onScheduleChange({ ...schedule, end_minute: num });
                          }
                        }}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor="#6b7280"
                        className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm"
                      />
                    )}
                  </View>
                </View>
              </View>
            </View>
          </View>

          <View>
            <Text className="text-gray-400 font-instrument text-xs mb-2">Days of Week</Text>
            <View className="flex-row gap-2 flex-wrap">
              {DAYS_OF_WEEK.map((day) => (
                <Pressable
                  key={day.value}
                  onPress={() => toggleDay(day.value)}
                  className={`px-3 py-2 rounded-lg ${
                    schedule.days_of_week.includes(day.value)
                      ? 'bg-brand-orange'
                      : 'bg-[#1A1A1A] border border-[#2A2A2A]'
                  }`}
                  style={
                    schedule.days_of_week.includes(day.value)
                      ? { backgroundColor: '#f85102' }
                      : undefined
                  }
                  accessibilityRole="checkbox"
                  accessibilityLabel={`Day of week: ${day.label}`}
                  accessibilityState={{
                    checked: schedule.days_of_week.includes(day.value),
                  }}
                >
                  <Text
                    className={`font-instrument-medium text-xs ${
                      schedule.days_of_week.includes(day.value)
                        ? 'text-white'
                        : 'text-gray-400'
                    }`}
                  >
                    {day.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        <View className="flex-row gap-3">
          <Pressable
            onPress={onBack}
            className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-6 py-3 flex-row items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text className="text-gray-300 font-instrument-semibold text-base">Back</Text>
          </Pressable>
          <Pressable
            onPress={onNext}
            className="flex-1 bg-brand-orange rounded-xl px-6 py-3 flex-row items-center justify-center"
            style={{ backgroundColor: '#f85102' }}
            accessibilityRole="button"
            accessibilityLabel="Next: Configure Lead"
          >
            <Text className="text-white font-instrument-semibold text-base">Next: Lead</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

