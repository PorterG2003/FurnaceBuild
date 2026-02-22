import { useState, useEffect } from 'react';
import { View, Text, Pressable, TextInput, Platform } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { IntervalMinutesInput } from '@/components/campaigns/IntervalMinutesInput';
import { updateCampaign } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
import {
  SCHEDULE_PRESETS,
  DAYS_OF_WEEK,
  TIMEZONES,
  HOURS,
  MINUTES,
  type ScheduleShape,
  type SchedulePreset,
  scheduleFromCampaign,
  applyPreset,
  formatHour12,
  scheduleMatchesPreset,
} from '@/lib/campaigns/utils';

interface ScheduleModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  campaign: Campaign | null;
  campaignId: string;
}

export function ScheduleModal({ visible, onClose, onSaved, campaign, campaignId }: ScheduleModalProps) {
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>('business-hours');
  const [schedule, setSchedule] = useState<ScheduleShape | null>(null);
  const [sendingIntervalSeconds, setSendingIntervalSeconds] = useState(300);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!visible || !campaign) return;
    const s = scheduleFromCampaign(campaign);
    if (s) {
      setSchedule(s);
      const matched =
        scheduleMatchesPreset(s, '24/7') ? '24/7' :
        scheduleMatchesPreset(s, 'business-hours') ? 'business-hours' : 'custom';
      setSchedulePreset(matched);
    } else {
      setSchedulePreset('24/7');
      setSchedule(applyPreset('24/7'));
    }
    setSendingIntervalSeconds(campaign.sending_interval_seconds ?? 300);
  }, [visible, campaign]);

  const intervalMinutes = Math.floor(sendingIntervalSeconds / 60);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload: { schedule?: ScheduleShape | null; sending_interval_seconds?: number } = {
        sending_interval_seconds: sendingIntervalSeconds,
      };
      payload.schedule = schedulePreset === '24/7' ? null : (schedule as any) ?? null;
      await updateCampaign(campaignId, payload);
      onSaved();
      onClose();
    } catch (err) {
      console.error('Error saving schedule:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Schedule & Interval"
      description="Configure when emails are sent and how often"
      maxWidth="2xl"
      maxHeight={720}
      footer={
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button onPress={onClose} variant="secondary">Cancel</Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button onPress={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </View>
        </View>
      }
    >
      <View style={{ gap: 24 }}>
        {/* Quick presets */}
        <View>
          <Text className="text-gray-400 font-instrument text-xs mb-2">Quick presets</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {SCHEDULE_PRESETS.map((p) => (
              <Pressable
                key={p.value}
                onPress={() => {
                  setSchedulePreset(p.value);
                  setSchedule(applyPreset(p.value));
                }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 8,
                  backgroundColor: schedulePreset === p.value ? '#f85102' : '#1A1A1A',
                  borderWidth: 1,
                  borderColor: '#2A2A2A',
                }}
              >
                <Text
                  className="font-instrument text-sm"
                  style={{ color: schedulePreset === p.value ? '#fff' : '#9CA3AF' }}
                >
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Schedule restrictions */}
        <View style={{ paddingTop: 16, borderTopWidth: 1, borderTopColor: '#2A2A2A', gap: 16 }}>
          <Text className="text-white font-instrument-semibold text-sm">Schedule restrictions</Text>

          <View>
            <Text className="text-gray-400 font-instrument text-xs mb-2">Timezone</Text>
            {Platform.OS === 'web' ? (
              <select
                value={schedule?.timezone ?? 'America/New_York'}
                onChange={(e) => {
                  if (schedule) {
                    setSchedule({ ...schedule, timezone: e.target.value });
                    setSchedulePreset('custom');
                  }
                }}
                style={{
                  width: '100%',
                  backgroundColor: '#1A1A1A',
                  border: '1px solid #2A2A2A',
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
                value={schedule?.timezone ?? ''}
                onChangeText={(t) => {
                  if (schedule) {
                    setSchedule({ ...schedule, timezone: t });
                    setSchedulePreset('custom');
                  }
                }}
                placeholder="America/New_York"
                placeholderTextColor="#6b7280"
                className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm"
                style={{ borderWidth: 1 }}
              />
            )}
          </View>

          <View>
            <Text className="text-gray-400 font-instrument text-xs mb-2">Time window</Text>
            {schedulePreset === '24/7' ? (
              <Text className="text-gray-500 font-instrument text-sm">24/7 – no time restrictions</Text>
            ) : (
              <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 100 }}>
                  <Text className="text-gray-500 font-instrument text-xs mb-1">Start</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {Platform.OS === 'web' ? (
                      <>
                        <select
                          value={String(schedule?.start_hour ?? 9)}
                          onChange={(e) => {
                            if (schedule) {
                              setSchedule({ ...schedule, start_hour: parseInt(e.target.value, 10) });
                              setSchedulePreset('custom');
                            }
                          }}
                          style={{ flex: 1, backgroundColor: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 8, padding: 8, color: '#fff', fontSize: 14 }}
                        >
                          {HOURS.map((h) => (
                            <option key={h} value={h} style={{ backgroundColor: '#1A1A1A' }}>{formatHour12(h, 0)}</option>
                          ))}
                        </select>
                        <select
                          value={String(schedule?.start_minute ?? 0)}
                          onChange={(e) => {
                            if (schedule) {
                              setSchedule({ ...schedule, start_minute: parseInt(e.target.value, 10) });
                              setSchedulePreset('custom');
                            }
                          }}
                          style={{ flex: 1, backgroundColor: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 8, padding: 8, color: '#fff', fontSize: 14 }}
                        >
                          {MINUTES.map((m) => (
                            <option key={m} value={m} style={{ backgroundColor: '#1A1A1A' }}>{String(m).padStart(2, '0')}</option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <TextInput
                        value={`${formatHour12(schedule?.start_hour ?? 9, schedule?.start_minute ?? 0)}`}
                        editable={false}
                        className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm flex-1"
                      />
                    )}
                  </View>
                </View>
                <View style={{ flex: 1, minWidth: 100 }}>
                  <Text className="text-gray-500 font-instrument text-xs mb-1">End</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {Platform.OS === 'web' ? (
                      <>
                        <select
                          value={String(schedule?.end_hour ?? 17)}
                          onChange={(e) => {
                            if (schedule) {
                              setSchedule({ ...schedule, end_hour: parseInt(e.target.value, 10) });
                              setSchedulePreset('custom');
                            }
                          }}
                          style={{ flex: 1, backgroundColor: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 8, padding: 8, color: '#fff', fontSize: 14 }}
                        >
                          {HOURS.map((h) => (
                            <option key={h} value={h} style={{ backgroundColor: '#1A1A1A' }}>{formatHour12(h, 0)}</option>
                          ))}
                        </select>
                        <select
                          value={String(schedule?.end_minute ?? 0)}
                          onChange={(e) => {
                            if (schedule) {
                              setSchedule({ ...schedule, end_minute: parseInt(e.target.value, 10) });
                              setSchedulePreset('custom');
                            }
                          }}
                          style={{ flex: 1, backgroundColor: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 8, padding: 8, color: '#fff', fontSize: 14 }}
                        >
                          {MINUTES.map((m) => (
                            <option key={m} value={m} style={{ backgroundColor: '#1A1A1A' }}>{String(m).padStart(2, '0')}</option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <TextInput
                        value={`${formatHour12(schedule?.end_hour ?? 17, schedule?.end_minute ?? 0)}`}
                        editable={false}
                        className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm flex-1"
                      />
                    )}
                  </View>
                </View>
              </View>
            )}
          </View>

          <View>
            <Text className="text-gray-400 font-instrument text-xs mb-2">Days of week</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {DAYS_OF_WEEK.map((day) => (
                <Pressable
                  key={day.value}
                  onPress={() => {
                    if (!schedule) return;
                    const has = schedule.days_of_week.includes(day.value);
                    setSchedule({
                      ...schedule,
                      days_of_week: has
                        ? schedule.days_of_week.filter((d) => d !== day.value)
                        : [...schedule.days_of_week, day.value].sort((a, b) => a - b),
                    });
                    setSchedulePreset('custom');
                  }}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 8,
                    backgroundColor: (schedule?.days_of_week ?? []).includes(day.value) ? '#f85102' : '#1A1A1A',
                    borderWidth: 1,
                    borderColor: '#2A2A2A',
                  }}
                >
                  <Text
                    className="font-instrument-medium text-xs"
                    style={{ color: (schedule?.days_of_week ?? []).includes(day.value) ? '#fff' : '#9CA3AF' }}
                  >
                    {day.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {/* Sending interval */}
        <View style={{ paddingTop: 16, borderTopWidth: 1, borderTopColor: '#2A2A2A' }}>
          <Text className="text-white font-instrument-semibold text-sm mb-1">Sending interval</Text>
          <Text className="text-gray-400 font-instrument text-xs mb-3">Time between sends per mailbox</Text>
          <IntervalMinutesInput
            value={intervalMinutes}
            onChange={(mins) => setSendingIntervalSeconds(Math.max(1, mins) * 60)}
            schedule={schedule}
          />
        </View>
      </View>
    </BaseModal>
  );
}
