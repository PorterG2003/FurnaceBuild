import { ScrollView, Text, View } from 'react-native';
import {
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  MegaphoneIcon,
  ExclamationTriangleIcon,
  UserIcon,
} from 'react-native-heroicons/outline';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { EmptyState, LoadingState } from '@/components/ui/feedback';
import type { SmartleadMigrationRun } from '@/lib/supabase/types';
import { ACTIVE_RUN_STATUSES } from './constants';
import { formatCount, getRunSummary } from './utils';
import { MigrationInlineNotice, MigrationStatusPill } from './components/MigrationReviewPrimitives';

interface MigrationHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  runs: SmartleadMigrationRun[];
  loading: boolean;
  error: string | null;
  onReviewRun: (runId: string) => void;
}

function HistoryStatChip({
  icon: Icon,
  value,
  label,
  color,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  value: string;
  label: string;
  color: string;
}) {
  return (
    <View className="flex-row items-center" style={{ flex: 1, minWidth: 88 }}>
      <View className="mr-3 h-9 w-9 items-center justify-center rounded-md bg-[#171717]">
        <Icon size={20} color={color} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-instrument-semibold text-base" style={{ color }}>
          {value}
        </Text>
        <Text className="font-instrument text-xs text-gray-500">{label}</Text>
      </View>
    </View>
  );
}

function getRunTone(run: SmartleadMigrationRun): 'neutral' | 'success' | 'warning' | 'danger' {
  if (ACTIVE_RUN_STATUSES.includes(run.status)) return 'neutral';
  if (run.status === 'completed') return 'success';
  if (run.status === 'completed_with_warnings' || run.status === 'cancelled') return 'warning';
  if (run.status === 'failed' || run.status === 'failed_to_launch' || run.status === 'failed_to_claim') {
    return 'danger';
  }
  return 'neutral';
}

function formatHistoryTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function MigrationHistoryModal({
  visible,
  onClose,
  runs,
  loading,
  error,
  onReviewRun,
}: MigrationHistoryModalProps) {
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Migration History"
      description="Review any Smartlead migration run without cluttering the account page."
      maxWidth="3xl"
      maxHeight={720}
    >
      <View className="gap-4" style={{ flex: 1 }}>
        {error ? (
          <MigrationInlineNotice body={error} tone="danger" />
        ) : null}

        {loading && runs.length === 0 ? (
          <LoadingState message="Loading migration history..." />
        ) : runs.length === 0 ? (
          <EmptyState
            title="No migrations yet"
            description="Run a Smartlead migration to see completed and active runs here."
            className="py-8"
          />
        ) : (
          <ScrollView showsVerticalScrollIndicator contentContainerStyle={{ gap: 12 }}>
            {runs.map((run) => {
              const isActive = ACTIVE_RUN_STATUSES.includes(run.status);
              return (
                <View
                  key={run.id}
                  className="rounded-lg border border-[#2A2A2A] bg-[#141414] px-3.5 py-3"
                >
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text className="text-sm font-instrument-medium text-white">
                        {isActive ? 'Active migration' : 'Migration run'}
                      </Text>
                      <Text className="mt-0.5 text-xs font-instrument text-gray-400">
                        {getRunSummary(run)}
                      </Text>
                    </View>
                    <MigrationStatusPill
                      label={run.status.replace(/_/g, ' ')}
                      tone={getRunTone(run)}
                    />
                  </View>

                  <View className="mt-3 flex-row flex-wrap gap-2">
                    <HistoryStatChip
                      icon={MegaphoneIcon}
                      value={formatCount(run.selected_campaign_count)}
                      label="Campaigns"
                      color="#22c55e"
                    />
                    <HistoryStatChip
                      icon={UserIcon}
                      value={formatCount(run.leads_imported)}
                      label="Leads"
                      color="#a78bfa"
                    />
                    <HistoryStatChip
                      icon={ChatBubbleLeftRightIcon}
                      value={formatCount(run.conversations_imported)}
                      label="Conversations"
                      color="#14b8a6"
                    />
                    <HistoryStatChip
                      icon={ExclamationTriangleIcon}
                      value={formatCount(run.warning_count)}
                      label="Warnings"
                      color="#f59e0b"
                    />
                  </View>

                  {run.last_error_message ? (
                    <View className="mt-3">
                      <MigrationInlineNotice body={run.last_error_message} tone="danger" />
                    </View>
                  ) : null}

                  <View className="mt-3 flex-row items-center justify-between border-t border-[#222222] pt-3">
                    <View className="flex-row items-center gap-1.5">
                      <CalendarDaysIcon size={12} color="#6b7280" />
                      <Text className="text-[11px] font-instrument text-gray-500">
                        {formatHistoryTimestamp(run.created_at)}
                      </Text>
                    </View>
                    <Button variant="secondary" size="sm" onPress={() => onReviewRun(run.id)}>
                      {isActive ? 'View Migration' : 'Review Migration'}
                    </Button>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </BaseModal>
  );
}
