import { ScrollView, Text, View } from 'react-native';
import type { MigrationProgress } from '@/lib/smartlead/migration';
import type { SmartleadMigrationEvent, SmartleadMigrationRun } from '@/lib/supabase/types';
import { formatCount, formatDateTime, getRunDetail, getRunHeading, getRunSummary } from '../utils';
import { MigrationProgressSkeleton } from './Skeletons';

interface MigrationProgressStepProps {
  error: string | null;
  run: SmartleadMigrationRun | null;
  migrating: boolean;
  progress: MigrationProgress | null;
  runEvents: SmartleadMigrationEvent[];
  showRunSkeleton: boolean;
  windowHeight: number;
  eventsSummary: string;
}

function ActivityEventList({
  events,
  dense = false,
}: {
  events: SmartleadMigrationEvent[];
  dense?: boolean;
}) {
  return (
    <View className="gap-2">
      {events.map((event) => (
        <View
          key={event.id}
          className={`rounded-lg border border-[#232323] bg-[#101010] px-3 ${dense ? 'py-2' : 'py-3'}`}
        >
          <View className="flex-row items-center justify-between gap-3">
            <Text
              className={`text-xs font-instrument-medium ${
                event.level === 'error'
                  ? 'text-red-400'
                  : event.level === 'warning'
                    ? 'text-amber-300'
                    : 'text-white'
              }`}
            >
              {event.detail ?? event.event_type.replace(/_/g, ' ')}
            </Text>
            <Text className="text-[10px] text-gray-500 font-instrument">
              {formatDateTime(event.created_at)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function MigrationProgressStep({
  error,
  run,
  migrating,
  progress,
  runEvents,
  showRunSkeleton,
  windowHeight,
  eventsSummary,
}: MigrationProgressStepProps) {
  return (
    <View className="gap-4" style={{ flex: 1 }}>
      {error && (
        <View className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <Text className="text-red-400 text-sm font-instrument">{error}</Text>
        </View>
      )}

      {run && (
        <View className="rounded-xl border border-[#2A2A2A] bg-[#141414] p-4 gap-4">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-white text-sm font-instrument-medium">{getRunHeading(run, migrating)}</Text>
              <Text className="text-gray-400 text-xs font-instrument mt-1">{getRunSummary(run)}</Text>
            </View>
            <View className="px-2.5 py-1 rounded-full border border-[#2A2A2A] bg-[#1B1B1B]">
              <Text className="text-xs text-gray-300 font-instrument-medium capitalize">
                {run.status.replace(/_/g, ' ')}
              </Text>
            </View>
          </View>

          <View className="h-2 rounded-full bg-[#1F1F1F] overflow-hidden">
            <View
              style={{
                width: `${run.selected_campaign_count > 0
                  ? Math.min(
                      100,
                      ((run.completed_campaign_count + run.failed_campaign_count) / run.selected_campaign_count) * 100,
                    )
                  : 0}%`,
                height: '100%',
                backgroundColor: '#F3440D',
              }}
            />
          </View>

          {getRunDetail(run, progress) ? (
            <View className="gap-1">
              <Text className="text-white text-sm font-instrument-medium">
                {progress?.campaignName || (
                  run.status === 'task_started'
                    ? 'Worker startup in progress'
                    : run.status === 'launch_requested' || run.status === 'queued'
                      ? 'Launcher in progress'
                      : run.status === 'failed_to_launch'
                        ? 'Task was never created'
                        : run.status === 'failed_to_claim'
                          ? 'Worker never claimed run'
                          : 'Waiting for update'
                )}
              </Text>
              <Text className="text-gray-400 text-xs font-instrument">{getRunDetail(run, progress)}</Text>
            </View>
          ) : null}

          <View className="flex-row flex-wrap gap-4">
            <View>
              <Text className="text-[11px] uppercase tracking-wide text-gray-500 font-instrument-medium">Leads</Text>
              <Text className="text-white text-sm font-instrument-medium">{formatCount(run.leads_imported)}</Text>
            </View>
            <View>
              <Text className="text-[11px] uppercase tracking-wide text-gray-500 font-instrument-medium">
                Conversations
              </Text>
              <Text className="text-white text-sm font-instrument-medium">
                {formatCount(run.conversations_imported)}
              </Text>
            </View>
            <View>
              <Text className="text-[11px] uppercase tracking-wide text-gray-500 font-instrument-medium">Stats</Text>
              <Text className="text-white text-sm font-instrument-medium">
                {formatCount(run.totals_stats_campaign_count)} totals / {formatCount(run.day_by_day_stats_campaign_count)} daily
              </Text>
            </View>
          </View>

          {run.last_error_message ? (
            <View className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <Text className="text-red-400 text-xs font-instrument">{run.last_error_message}</Text>
            </View>
          ) : null}
        </View>
      )}

      {!run && showRunSkeleton && <MigrationProgressSkeleton />}

      {runEvents.length > 0 && (
        <View className="rounded-xl border border-[#2A2A2A] bg-[#141414] p-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-white text-sm font-instrument-medium">Recent Activity</Text>
            <Text className="text-gray-500 text-xs font-instrument">{eventsSummary}</Text>
          </View>
          <ScrollView style={{ maxHeight: Math.round(windowHeight * 0.18) }} showsVerticalScrollIndicator>
            <ActivityEventList events={runEvents} dense />
          </ScrollView>
        </View>
      )}
    </View>
  );
}
