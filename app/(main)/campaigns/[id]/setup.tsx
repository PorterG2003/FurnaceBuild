import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'react-native-heroicons/outline';
import { PageLayout, Breadcrumb } from '@/components/ui/layout';
import { LoadingState, Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import {
  getCampaignById,
  getCampaignMailboxes,
  updateCampaign,
  assignMailboxesToCampaign,
  backfillCampaignEnrollments,
  cancelUnsentCampaignJobs,
} from '@/lib/supabase/services/campaigns';
import { getMailboxesByAccount } from '@/lib/supabase/services/mailboxes';
import type { Campaign } from '@/lib/supabase/types';

const SCHEDULE_PRESETS = [
  { value: '24/7', label: '24/7 (No restrictions)' },
  { value: 'business-hours', label: 'Business hours (9–5 Mon–Fri)' },
  { value: 'weekdays-only', label: 'Weekdays only (24/7 Mon–Fri)' },
] as const;

type SchedulePreset = (typeof SCHEDULE_PRESETS)[number]['value'] | 'custom';

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
  { value: 'America/Phoenix', label: 'Arizona (MST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
] as const;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

interface ScheduleShape {
  timezone: string;
  start_hour: number;
  start_minute?: number;
  end_hour: number;
  end_minute?: number;
  days_of_week: number[];
}

function scheduleFromCampaign(campaign: Campaign | null): ScheduleShape | null {
  if (!campaign?.schedule) return null;
  const s =
    typeof campaign.schedule === 'string'
      ? JSON.parse(campaign.schedule)
      : campaign.schedule;
  const sh = s as ScheduleShape;
  return {
    ...sh,
    start_minute: sh.start_minute ?? 0,
    end_minute: sh.end_minute ?? 0,
  };
}

function applyPreset(preset: SchedulePreset): ScheduleShape {
  switch (preset) {
    case '24/7':
      return {
        timezone: 'America/New_York',
        start_hour: 0,
        start_minute: 0,
        end_hour: 23,
        end_minute: 59,
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
      };
    case 'business-hours':
      return {
        timezone: 'America/New_York',
        start_hour: 9,
        start_minute: 0,
        end_hour: 17,
        end_minute: 0,
        days_of_week: [1, 2, 3, 4, 5],
      };
    case 'weekdays-only':
      return {
        timezone: 'America/New_York',
        start_hour: 0,
        start_minute: 0,
        end_hour: 23,
        end_minute: 59,
        days_of_week: [1, 2, 3, 4, 5],
      };
    default:
      return {
        timezone: 'America/New_York',
        start_hour: 9,
        start_minute: 0,
        end_hour: 17,
        end_minute: 0,
        days_of_week: [1, 2, 3, 4, 5],
      };
  }
}

function formatHour12(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  const m = minute;
  return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function scheduleMatchesPreset(schedule: ScheduleShape | null, preset: SchedulePreset): boolean {
  if (!schedule || preset === 'custom') return false;
  const applied = applyPreset(preset as '24/7' | 'business-hours' | 'weekdays-only');
  return (
    schedule.timezone === applied.timezone &&
    schedule.start_hour === applied.start_hour &&
    (schedule.start_minute ?? 0) === (applied.start_minute ?? 0) &&
    schedule.end_hour === applied.end_hour &&
    (schedule.end_minute ?? 59) === (applied.end_minute ?? 59) &&
    schedule.days_of_week.length === applied.days_of_week.length &&
    schedule.days_of_week.every((d, i) => d === applied.days_of_week[i])
  );
}

function calculateEmailsPerMailboxPerDay(schedule: ScheduleShape | null, intervalMinutes: number): string {
  if (!schedule || !intervalMinutes || intervalMinutes <= 0) return '—';
  const startMin = (schedule.start_hour ?? 0) * 60 + (schedule.start_minute ?? 0);
  const endMin = (schedule.end_hour ?? 0) * 60 + (schedule.end_minute ?? 0);
  let windowMinutes: number;
  if (startMin === 0 && endMin >= 1439 && (schedule.days_of_week?.length ?? 0) === 7) {
    windowMinutes = 24 * 60;
  } else if (endMin > startMin) {
    windowMinutes = endMin - startMin;
  } else if (endMin < startMin) {
    windowMinutes = 24 * 60 - startMin + endMin;
  } else {
    windowMinutes = (schedule.days_of_week?.length ?? 0) === 7 ? 24 * 60 : 0;
  }
  if (windowMinutes === 0) return '0';
  const intervalsPerWindow = Math.floor(windowMinutes / intervalMinutes);
  const daysCount = schedule.days_of_week?.length ?? 0;
  if (daysCount === 7) return `~${intervalsPerWindow} per mailbox per day`;
  const avgPerDay = Math.round((intervalsPerWindow * daysCount) / 7 * 100) / 100;
  return `~${intervalsPerWindow} per scheduled day (avg ${avgPerDay} per calendar day)`;
}

function hasFlowBuilt(campaign: Campaign | null): boolean {
  if (!campaign?.flow_data) return false;
  try {
    const fd =
      typeof campaign.flow_data === 'string'
        ? JSON.parse(campaign.flow_data)
        : campaign.flow_data;
    const nodes = Array.isArray((fd as any)?.nodes) ? (fd as any).nodes : [];
    return nodes.length > 0;
  } catch {
    return false;
  }
}

function isScheduleSet(_campaign: Campaign | null): boolean {
  return true;
}

export default function CampaignSetupPage() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [mailboxes, setMailboxes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>('business-hours');
  const [schedule, setSchedule] = useState<ScheduleShape | null>(null);
  const [sendingIntervalSeconds, setSendingIntervalSeconds] = useState(300);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [accountMailboxes, setAccountMailboxes] = useState<any[]>([]);
  const [isSavingMailboxes, setIsSavingMailboxes] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mailboxSearch, setMailboxSearch] = useState('');
  const [intervalInputStr, setIntervalInputStr] = useState<string | null>(null);

  const loadCampaign = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setIsLoading(true);
    try {
      const [data, mailboxList] = await Promise.all([
        getCampaignById(id),
        getCampaignMailboxes(id),
      ]);
      setCampaign(data);
      setMailboxes(mailboxList || []);
      setLoadError(null);
      if (data) {
        const s = scheduleFromCampaign(data);
        if (s) {
          setSchedule(s);
          const matched =
            scheduleMatchesPreset(s, '24/7') ? '24/7' :
            scheduleMatchesPreset(s, 'business-hours') ? 'business-hours' :
            scheduleMatchesPreset(s, 'weekdays-only') ? 'weekdays-only' : 'custom';
          setSchedulePreset(matched);
        } else {
          setSchedulePreset('24/7');
          setSchedule(applyPreset('24/7'));
        }
        setSendingIntervalSeconds(data.sending_interval_seconds ?? 300);
        setIntervalInputStr(null);
        if (data.account_id) {
          try {
            const all = await getMailboxesByAccount(data.account_id);
            setAccountMailboxes(all || []);
          } catch {
            setAccountMailboxes([]);
          }
        } else {
          setAccountMailboxes([]);
        }
      }
    } catch (err) {
      console.error('Error loading campaign:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load campaign');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCampaign();
  }, [loadCampaign]);

  const nameSet = !!(campaign?.name?.trim());
  const flowBuilt = hasFlowBuilt(campaign);
  const scheduleSet = isScheduleSet(campaign);
  const mailboxesAdded = mailboxes.length >= 1;
  const isDraft = campaign?.status === 'draft';
  const isRunning = campaign?.status === 'running';
  const isPaused = campaign?.status === 'paused';
  const canStart =
    isDraft && nameSet && flowBuilt && scheduleSet && mailboxesAdded;

  const handleStartCampaign = async () => {
    if (!id || !canStart) return;
    setIsStarting(true);
    try {
      await backfillCampaignEnrollments(id);
      await updateCampaign(id, { status: 'running' });
      await loadCampaign(true);
    } catch (err) {
      console.error('Error starting campaign:', err);
    } finally {
      setIsStarting(false);
    }
  };

  const handlePause = async () => {
    if (!id) return;
    setIsPausing(true);
    try {
      await updateCampaign(id, { status: 'paused' });
      await cancelUnsentCampaignJobs(id, 'Campaign paused');
      await loadCampaign(true);
    } catch (err) {
      console.error('Error pausing campaign:', err);
    } finally {
      setIsPausing(false);
    }
  };

  const handleResume = async () => {
    if (!id) return;
    setIsStarting(true);
    try {
      await updateCampaign(id, { status: 'running' });
      await loadCampaign(true);
    } catch (err) {
      console.error('Error resuming campaign:', err);
    } finally {
      setIsStarting(false);
    }
  };

  /** Stop campaign and cancel all unsent message jobs. Call cancelUnsentCampaignJobs whenever setting status to 'stopped'. */
  const handleStop = async () => {
    if (!id) return;
    setIsStopping(true);
    try {
      await updateCampaign(id, { status: 'stopped' });
      await cancelUnsentCampaignJobs(id, 'Campaign stopped');
      await loadCampaign(true);
    } catch (err) {
      console.error('Error stopping campaign:', err);
    } finally {
      setIsStopping(false);
    }
  };

  const handleEditFlow = () => {
    if (id) router.push({ pathname: '/builder', params: { campaignId: id } });
  };

  const handleSaveScheduleAndInterval = async () => {
    if (!id) return;
    setIsSavingSettings(true);
    try {
      const payload: { schedule?: ScheduleShape | null; sending_interval_seconds?: number } = {
        sending_interval_seconds: sendingIntervalSeconds,
      };
      payload.schedule =
        schedulePreset === '24/7' ? null : (schedule as any) ?? null;
      await updateCampaign(id, payload);
      await loadCampaign(true);
    } catch (err) {
      console.error('Error saving settings:', err);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const assignedMailboxIds = useMemo(() => new Set(mailboxes.map((m: any) => m.id)), [mailboxes]);

  const handleToggleMailbox = async (mailboxId: string) => {
    if (!id) return;
    const next = assignedMailboxIds.has(mailboxId)
      ? [...mailboxes.filter((m: any) => m.id !== mailboxId).map((m: any) => m.id)]
      : [...mailboxes.map((m: any) => m.id), mailboxId];
    setIsSavingMailboxes(true);
    try {
      await assignMailboxesToCampaign(id, next);
      await loadCampaign(true);
    } catch (err) {
      console.error('Error updating mailboxes:', err);
    } finally {
      setIsSavingMailboxes(false);
    }
  };

  const filteredAccountMailboxes = useMemo(() => {
    if (!mailboxSearch.trim()) return accountMailboxes;
    const q = mailboxSearch.trim().toLowerCase();
    return accountMailboxes.filter(
      (m: any) =>
        (m.email_address || '').toLowerCase().includes(q) ||
        (m.display_name || '').toLowerCase().includes(q)
    );
  }, [accountMailboxes, mailboxSearch]);

  const intervalMinutes = Math.floor(sendingIntervalSeconds / 60);
  const setIntervalMinutes = (mins: number) => {
    setSendingIntervalSeconds(Math.max(1, mins) * 60);
  };

  const handleBack = () => {
    if (id) router.push({ pathname: '/campaigns/[id]', params: { id } });
  };

  const steps = [
    { label: 'Name', done: nameSet },
    { label: 'Flow', done: flowBuilt, onPress: !flowBuilt ? handleEditFlow : undefined },
    { label: 'Schedule', done: scheduleSet },
    { label: 'Mailboxes', done: mailboxesAdded },
  ];

  const showProgressBar = !isLoading && !loadError && !!campaign && campaign.status !== 'running' && campaign.status !== 'paused' && campaign.status !== 'stopped';

  return (
    <PageLayout scrollable={false} contentPadding={0}>
      <View
        style={{
          backgroundColor: '#121212',
          borderBottomWidth: 1,
          borderBottomColor: '#2A2A2A',
          zIndex: 10,
        }}
      >
        {/* Row 1: Breadcrumb + Back */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 24,
            paddingVertical: 16,
          }}
        >
          <Breadcrumb
            items={[
              { label: 'Campaigns', href: '/campaigns' },
              {
                label: isLoading ? 'Loading...' : (campaign?.name || 'Campaign'),
                href: id ? `/campaigns/${id}` : undefined,
              },
              { label: 'Setup' },
            ]}
          />
          <Pressable
            onPress={handleBack}
            className="px-4 py-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
          >
            <Text className="text-white font-instrument-medium text-sm">
              Back
            </Text>
          </Pressable>
        </View>

        {/* Row 2 (draft only): Progress bar */}
        {showProgressBar && (
          <View
            style={{
              paddingHorizontal: 24,
              paddingBottom: 16,
            }}
          >
            <View style={{ flexDirection: 'row', marginBottom: 8 }}>
              {steps.map((step, i) => (
                <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                  {step.onPress ? (
                    <Pressable onPress={step.onPress}>
                      <Text
                        className="font-instrument text-xs text-gray-400"
                      >
                        {step.label}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text
                      className="font-instrument text-xs text-gray-400"
                    >
                      {step.label}
                    </Text>
                  )}
                </View>
              ))}
            </View>
            <View style={{ height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: '#2A2A2A' }}>
              <View
                style={{
                  height: '100%',
                  width: `${(steps.filter((s) => s.done).length / steps.length) * 100}%`,
                  backgroundColor: '#F3440D',
                  borderTopLeftRadius: 3,
                  borderBottomLeftRadius: 3,
                }}
              />
            </View>
          </View>
        )}

        {/* Row 2 (launched): Status + Pause/Resume */}
        {!isLoading && !loadError && (isRunning || isPaused || campaign?.status === 'stopped') && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 24,
              paddingBottom: 16,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {(isRunning || isPaused) && (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: isRunning ? '#F3440D' : '#F59E0B',
                  }}
                />
              )}
              <Text className="text-gray-400 font-instrument text-sm">
                {isRunning && 'Campaign is running'}
                {isPaused && 'Campaign is paused'}
                {campaign?.status === 'stopped' && 'This campaign has been stopped'}
              </Text>
            </View>
            {isRunning && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  onPress={handlePause}
                  disabled={isPausing}
                  style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.5)', backgroundColor: 'rgba(245, 158, 11, 0.1)' }}
                >
                  <Text className="text-amber-400 font-instrument-medium text-sm">
                    {isPausing ? 'Pausing...' : 'Pause'}
                  </Text>
                </Pressable>
                <Button onPress={handleStop} disabled={isStopping} variant="outline">
                  {isStopping ? 'Stopping...' : 'Stop'}
                </Button>
              </View>
            )}
            {isPaused && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button onPress={handleResume} disabled={isStarting}>
                  {isStarting ? 'Resuming...' : 'Resume'}
                </Button>
                <Button onPress={handleStop} disabled={isStopping} variant="outline">
                  {isStopping ? 'Stopping...' : 'Stop'}
                </Button>
              </View>
            )}
          </View>
        )}
      </View>

      {isLoading ? (
        <LoadingState message="Loading setup..." />
      ) : loadError ? (
        <View style={{ padding: 24 }}>
          <Alert
            variant="error"
            message={loadError}
            actionText="Retry"
            onAction={loadCampaign}
          />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Card 1: Campaign details (test-style grid + custom schedule) */}
          <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-6">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <Text className="text-lg font-instrument-semibold text-white">
                Campaign details
              </Text>
              <View
                className="px-3 py-1 rounded-lg"
                style={{
                  backgroundColor:
                    campaign?.status === 'running'
                      ? '#10b98120'
                      : campaign?.status === 'paused'
                        ? '#f59e0b20'
                        : '#6b728020',
                }}
              >
                <Text
                  className="text-xs font-instrument-semibold uppercase"
                  style={{
                    color:
                      campaign?.status === 'running'
                        ? '#10b981'
                        : campaign?.status === 'paused'
                          ? '#f59e0b'
                          : '#6b7280',
                  }}
                >
                  {campaign?.status ?? 'draft'}
                </Text>
              </View>
            </View>

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
                <View style={{ alignSelf: 'flex-start', maxWidth: 280 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 8 }}>
                    <Pressable
                      onPress={() => setIntervalMinutes(intervalMinutes - 1)}
                      style={{ padding: 12 }}
                      disabled={intervalMinutes <= 1}
                    >
                      <ChevronDownIcon size={20} color={intervalMinutes <= 1 ? '#4B5563' : '#9CA3AF'} />
                    </Pressable>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 100 }}>
                      <TextInput
                        value={intervalInputStr !== null ? intervalInputStr : String(intervalMinutes)}
                        onChangeText={(t) => {
                          setIntervalInputStr(t);
                          const n = parseInt(t, 10);
                          if (!isNaN(n) && n >= 1) setIntervalMinutes(n);
                        }}
                        onBlur={() => {
                          const n = parseInt(intervalInputStr ?? '', 10);
                          if (isNaN(n) || n < 1) setIntervalMinutes(1);
                          setIntervalInputStr(null);
                        }}
                        onKeyDown={
                          Platform.OS === 'web'
                            ? (e: any) => {
                                const key = e.nativeEvent?.key ?? e.key;
                                if (key === 'ArrowUp') {
                                  e.preventDefault?.();
                                  setIntervalMinutes(intervalMinutes + 1);
                                  setIntervalInputStr(null);
                                } else if (key === 'ArrowDown') {
                                  e.preventDefault?.();
                                  setIntervalMinutes(Math.max(1, intervalMinutes - 1));
                                  setIntervalInputStr(null);
                                }
                              }
                            : undefined
                        }
                        keyboardType="number-pad"
                        placeholder="5"
                        placeholderTextColor="#6b7280"
                        className="text-white font-instrument text-base text-center"
                        style={{ width: 56, padding: 8 }}
                      />
                      <Text className="text-gray-400 font-instrument text-sm">minutes</Text>
                    </View>
                    <Pressable
                      onPress={() => setIntervalMinutes(intervalMinutes + 1)}
                      style={{ padding: 12 }}
                    >
                      <ChevronUpIcon size={20} color="#9CA3AF" />
                    </Pressable>
                  </View>
                </View>
                <Text className="text-gray-500 font-instrument text-xs mt-2">
                  {calculateEmailsPerMailboxPerDay(schedule, intervalMinutes)}
                </Text>
              </View>

              <Button
                onPress={handleSaveScheduleAndInterval}
                disabled={isSavingSettings}
              >
                {isSavingSettings ? 'Saving...' : 'Save schedule & interval'}
              </Button>
            </View>
          </View>

          {/* Card 2: Mailboxes (checkbox list + search) */}
          <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text className="text-lg font-instrument-semibold text-white">
                Mailboxes
              </Text>
            </View>
            <Text className="text-gray-400 font-instrument text-xs mb-3">
              Select which mailboxes send for this campaign. Assigned: {mailboxes.length}
            </Text>

            <View style={{ marginBottom: 12 }}>
              <TextInput
                value={mailboxSearch}
                onChangeText={setMailboxSearch}
                placeholder="Search by email or name..."
                placeholderTextColor="#6b7280"
                className="bg-[#121212] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm"
                style={{ borderWidth: 1 }}
              />
            </View>

            {accountMailboxes.length === 0 ? (
              <Text className="text-gray-500 font-instrument text-sm">
                No mailboxes in this account. Add mailboxes in Senders first.
              </Text>
            ) : filteredAccountMailboxes.length === 0 ? (
              <Text className="text-gray-500 font-instrument text-sm">
                No mailboxes match your search.
              </Text>
            ) : (
              <View style={{ borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 8, overflow: 'hidden' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#2A2A2A', backgroundColor: 'transparent' }}>
                  <View style={{ width: 28, marginRight: 8 }} />
                  <Text className="text-gray-400 font-instrument-medium text-xs uppercase">Email</Text>
                </View>
                {filteredAccountMailboxes.map((m: any) => {
                  const isAssigned = assignedMailboxIds.has(m.id);
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => handleToggleMailbox(m.id)}
                      disabled={isSavingMailboxes}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: '#2A2A2A',
                      }}
                    >
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          marginRight: 12,
                          borderRadius: 4,
                          borderWidth: 2,
                          borderColor: isAssigned ? '#f85102' : '#4B5563',
                          backgroundColor: isAssigned ? '#f85102' : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isAssigned && <CheckIcon size={12} color="#fff" />}
                      </View>
                      <Text className="text-white font-instrument text-sm flex-1" numberOfLines={1}>
                        {m.email_address || m.id}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {showProgressBar && (
            <View style={{ marginTop: 24 }}>
              <Button
                onPress={handleStartCampaign}
                disabled={!canStart || isStarting}
              >
                {isStarting ? 'Starting...' : 'Launch campaign'}
              </Button>
            </View>
          )}
        </ScrollView>
      )}
    </PageLayout>
  );
}
