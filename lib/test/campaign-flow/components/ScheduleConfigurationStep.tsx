import { View, Text, Pressable, TextInput, ScrollView, Platform } from 'react-native';
import type { ScheduleConfig, SchedulePreset } from '../types';
import { applySchedulePreset } from '../utils';

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

        {/* Schedule Configuration */}
        <View className="bg-[#121212] rounded-lg p-4 gap-4 mb-6">
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
              <Text className="text-gray-400 font-instrument text-xs mb-2">Start Time</Text>
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
              <Text className="text-gray-400 font-instrument text-xs mb-2">End Time</Text>
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

