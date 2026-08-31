import { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/DateInput';
import { Select } from '@/components/ui/forms';
import { IntervalMinutesInput } from '@/components/campaigns/IntervalMinutesInput';
import { useConfirmClose } from '@/hooks/useConfirmClose';
import { updateCampaign } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';
import {
  SCHEDULE_PRESETS,
  DAYS_OF_WEEK,
  TIMEZONES,
  HOURS,
  MINUTES,
  DEFAULT_SENDING_INTERVAL_SECONDS,
  type ScheduleShape,
  type SchedulePreset,
  scheduleFromCampaign,
  applyPreset,
  formatHour12,
  scheduleMatchesPreset,
  scheduleEquals,
} from '@/lib/campaigns/utils';
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  addYmdDays,
  earliestSelectableYmd,
  nextStatusAfterLifecycleEdit,
  parseYmd,
  validateLifecycleSchedule,
  validateLifecycleScheduleForStatus,
} from '@/lib/campaigns/lifecycleSchedule';
import type { CampaignStatus } from '@/lib/campaigns/flow/types';

const HOUR_ITEMS = HOURS.map((hour) => ({
  id: String(hour),
  label: formatHour12(hour, 0),
}));
const MINUTE_ITEMS = MINUTES.map((minute) => ({
  id: String(minute),
  label: String(minute).padStart(2, '0'),
}));

function TimePartSelect({
  value,
  items,
  onChange,
}: {
  value: string;
  items: Array<{ id: string; label: string }>;
  onChange: (id: string) => void;
}) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Select
        items={items}
        getItemId={(item) => item.id}
        getItemLabel={(item) => ({ primary: item.label })}
        value={value}
        onChange={onChange}
        searchable={false}
        variant="solid"
        size="compact"
        noMargin
        listMaxHeight={240}
      />
    </View>
  );
}

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
  const [sendingIntervalSeconds, setSendingIntervalSeconds] = useState(DEFAULT_SENDING_INTERVAL_SECONDS);
  const [startOn, setStartOn] = useState('');
  const [pauseOn, setPauseOn] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const initialRef = useRef<{
    schedule: ScheduleShape | null;
    preset: SchedulePreset;
    interval: number;
    startOn: string;
    pauseOn: string;
  } | null>(null);

  useEffect(() => {
    if (!visible || !campaign) return;
    const s = scheduleFromCampaign(campaign);
    let preset: SchedulePreset;
    let initialSchedule: ScheduleShape | null;
    if (s) {
      setSchedule(s);
      preset =
        scheduleMatchesPreset(s, '24/7') ? '24/7' :
        scheduleMatchesPreset(s, 'business-hours') ? 'business-hours' : 'custom';
      setSchedulePreset(preset);
      initialSchedule = s;
    } else {
      setSchedulePreset('24/7');
      initialSchedule = applyPreset('24/7');
      setSchedule(initialSchedule);
      preset = '24/7';
    }
    const interval = campaign.sending_interval_seconds ?? DEFAULT_SENDING_INTERVAL_SECONDS;
    setSendingIntervalSeconds(interval);
    const nextStartOn = parseYmd(campaign.start_date) ?? '';
    const nextPauseOn = parseYmd(campaign.pause_date) ?? '';
    setStartOn(nextStartOn);
    setPauseOn(nextPauseOn);
    if (campaign.schedule_timezone && initialSchedule) {
      initialSchedule = { ...initialSchedule, timezone: campaign.schedule_timezone };
      setSchedule(initialSchedule);
    }
    initialRef.current = {
      schedule: initialSchedule,
      preset,
      interval,
      startOn: nextStartOn,
      pauseOn: nextPauseOn,
    };
  }, [visible, campaign]);

  const isDirty =
    initialRef.current === null
      ? false
      : schedulePreset !== initialRef.current.preset ||
        sendingIntervalSeconds !== initialRef.current.interval ||
        startOn !== initialRef.current.startOn ||
        pauseOn !== initialRef.current.pauseOn ||
        !scheduleEquals(schedule, initialRef.current.schedule);

  const campaignStatus = (campaign?.status ?? 'draft') as CampaignStatus;
  const datesLocked = campaignStatus === 'stopped';
  const startLocked = datesLocked || campaignStatus === 'running';
  const timezoneLocked = datesLocked || campaignStatus === 'running';

  const handleClose = useConfirmClose(isDirty, onClose);

  const intervalMinutes = Math.floor(sendingIntervalSeconds / 60);
  const timeZone = schedule?.timezone || campaign?.schedule_timezone || DEFAULT_SCHEDULE_TIMEZONE;
  const earliestSelectable = earliestSelectableYmd(new Date(), timeZone);
  const startMin = earliestSelectable;
  const parsedStartOn = parseYmd(startOn);
  const parsedPauseOn = parseYmd(pauseOn);
  const startMax = parsedPauseOn ? addYmdDays(parsedPauseOn, -1) : undefined;
  const pauseMinFromStart = parsedStartOn ? addYmdDays(parsedStartOn, 1) : null;
  const pauseMin =
    pauseMinFromStart && pauseMinFromStart > earliestSelectable
      ? pauseMinFromStart
      : earliestSelectable;

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const nextStart = startOn.trim() ? parseYmd(startOn) : null;
      const nextPause = pauseOn.trim() ? parseYmd(pauseOn) : null;
      if (startOn.trim() && !nextStart) {
        setSaveError('Start sending date must be a valid calendar date.');
        return;
      }
      if (pauseOn.trim() && !nextPause) {
        setSaveError('Pause date must be a valid calendar date.');
        return;
      }
      if (!startLocked && nextStart && nextStart < earliestSelectable) {
        setSaveError('start_on must be a future local date');
        return;
      }
      if (!datesLocked && nextPause && nextPause < earliestSelectable) {
        setSaveError('pause_on must be a future local date');
        return;
      }
      const nextLifecycle = { time_zone: timeZone, start_on: nextStart, pause_on: nextPause };
      const currentLifecycle = {
        time_zone: campaign?.schedule_timezone || DEFAULT_SCHEDULE_TIMEZONE,
        start_on: parseYmd(campaign?.start_date),
        pause_on: parseYmd(campaign?.pause_date),
      };
      const statusError = validateLifecycleScheduleForStatus({
        status: (campaign?.status ?? 'draft') as CampaignStatus,
        current: currentLifecycle,
        next: nextLifecycle,
      });
      if (statusError) {
        setSaveError(statusError.message);
        return;
      }
      const shapeError = validateLifecycleSchedule(nextLifecycle);
      if (shapeError) {
        setSaveError(shapeError.message);
        return;
      }
      const payload: {
        schedule?: ScheduleShape | null;
        sending_interval_seconds?: number;
        schedule_timezone: string;
        start_date: string | null;
        pause_date: string | null;
        status?: CampaignStatus;
      } = {
        sending_interval_seconds: sendingIntervalSeconds,
        schedule_timezone: timeZone,
        start_date: nextStart,
        pause_date: nextPause,
      };
      payload.schedule = schedulePreset === '24/7' ? null : (schedule as any) ?? null;
      const statusChange = nextStatusAfterLifecycleEdit(
        (campaign?.status ?? 'draft') as CampaignStatus,
        nextStart,
        timeZone,
      );
      if (statusChange) payload.status = statusChange;
      await updateCampaign(campaignId, payload);
      onSaved();
      onClose();
    } catch (err) {
      console.error('Error saving schedule:', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to save schedule');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Schedule & Interval"
      description="Configure when emails are sent and how often"
      maxWidth="2xl"
      maxHeight={780}
      footer={
        <ModalFooter>
          <Button onPress={handleClose} variant="secondary">Cancel</Button>
          <Button onPress={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button onPress={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      }
    >
      {saveError ? (
        <Text className="text-red-400 font-instrument text-sm mb-3">{saveError}</Text>
      ) : null}
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
                  const applied = applyPreset(p.value);
                  if (p.value === '24/7' && schedule?.timezone) {
                    setSchedule({ ...applied, timezone: schedule.timezone });
                  } else {
                    setSchedule(applied);
                  }
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

          <Select
            label="Timezone"
            items={[...TIMEZONES]}
            getItemId={(item) => item.value}
            getItemLabel={(item) => ({ primary: item.label })}
            value={schedule?.timezone ?? DEFAULT_SCHEDULE_TIMEZONE}
            onChange={(id) => {
              if (schedule) {
                setSchedule({ ...schedule, timezone: id });
                setSchedulePreset('custom');
              }
            }}
            placeholder="Select timezone…"
            variant="solid"
            noMargin
            disabled={timezoneLocked}
            searchPlaceholder="Search timezones…"
          />

          <View>
            <Text className="text-gray-400 font-instrument text-xs mb-2">Time window</Text>
            {schedulePreset === '24/7' ? (
              <Text className="text-gray-500 font-instrument text-sm">24/7 – no time restrictions</Text>
            ) : (
              <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 160, gap: 6 }}>
                  <Text className="text-gray-500 font-instrument text-xs">Start</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TimePartSelect
                      items={HOUR_ITEMS}
                      value={String(schedule?.start_hour ?? 9)}
                      onChange={(id) => {
                        if (schedule) {
                          setSchedule({ ...schedule, start_hour: parseInt(id, 10) });
                          setSchedulePreset('custom');
                        }
                      }}
                    />
                    <TimePartSelect
                      items={MINUTE_ITEMS}
                      value={String(schedule?.start_minute ?? 0)}
                      onChange={(id) => {
                        if (schedule) {
                          setSchedule({ ...schedule, start_minute: parseInt(id, 10) });
                          setSchedulePreset('custom');
                        }
                      }}
                    />
                  </View>
                </View>
                <View style={{ flex: 1, minWidth: 160, gap: 6 }}>
                  <Text className="text-gray-500 font-instrument text-xs">End</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TimePartSelect
                      items={HOUR_ITEMS}
                      value={String(schedule?.end_hour ?? 17)}
                      onChange={(id) => {
                        if (schedule) {
                          setSchedule({ ...schedule, end_hour: parseInt(id, 10) });
                          setSchedulePreset('custom');
                        }
                      }}
                    />
                    <TimePartSelect
                      items={MINUTE_ITEMS}
                      value={String(schedule?.end_minute ?? 0)}
                      onChange={(id) => {
                        if (schedule) {
                          setSchedule({ ...schedule, end_minute: parseInt(id, 10) });
                          setSchedulePreset('custom');
                        }
                      }}
                    />
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

        {/* Campaign dates */}
        <View style={{ paddingTop: 16, borderTopWidth: 1, borderTopColor: '#2A2A2A', gap: 16 }}>
          <Text className="text-white font-instrument-semibold text-sm">Campaign dates</Text>
          <Text className="text-gray-400 font-instrument text-xs">
            Optional. Dates must be after today in this campaign timezone ({timeZone}). Empty start sends as soon as you launch. Empty pause never auto-pauses.
          </Text>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 160 }}>
              <DateInput
                label="Start sending"
                value={startOn}
                onChange={setStartOn}
                min={startMin}
                max={startMax ?? undefined}
                placeholder="Launch immediately"
                disabled={startLocked}
                variant="solid"
                triggerSize="comfortable"
                onClear={!startLocked ? () => setStartOn('') : undefined}
              />
            </View>
            <View style={{ flex: 1, minWidth: 160 }}>
              <DateInput
                label="Pause at"
                value={pauseOn}
                onChange={setPauseOn}
                min={pauseMin}
                placeholder="Never auto-pause"
                disabled={datesLocked}
                variant="solid"
                triggerSize="comfortable"
                onClear={!datesLocked ? () => setPauseOn('') : undefined}
              />
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
