import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { PageLayout, PageHeader } from '@/components/ui/layout';
import { Card } from '@/components/ui/Card';
import { DateInput } from '@/components/ui/DateInput';
import { Alert } from '@/components/ui/feedback';
import { CampaignStatsChart } from '@/components/campaigns/CampaignStatsChart';
import { useAccount } from '@/contexts/AccountContext';
import { fillMissingStatsByDay } from '@/lib/campaigns/fillMissingStatsByDay';
import {
  getAccountOutreachMetrics,
  getAccountOutreachStatsByDay,
  type AccountOutreachMetrics,
  type CampaignStatsByDay,
} from '@/lib/supabase/services/campaigns';
import {
  PaperAirplaneIcon,
  CheckCircleIcon,
  UserGroupIcon,
  ClockIcon,
} from 'react-native-heroicons/outline';

function formatInt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

function utcYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 29),
  );
  return { start: utcYmd(start), end: utcYmd(end) };
}

export default function AccountMetricsPage() {
  const { account } = useAccount();
  const initialRange = useMemo(() => defaultRange(), []);
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [metrics, setMetrics] = useState<AccountOutreachMetrics | null>(null);
  const [statsByDay, setStatsByDay] = useState<CampaignStatsByDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);

  useEffect(() => {
    setWarningDismissed(false);
  }, [account?.id, startDate, endDate]);

  const load = useCallback(async () => {
    if (!account?.id) return;
    if (!startDate || !endDate) return;
    if (startDate > endDate) {
      setError('Start date must be on or before end date.');
      setMetrics(null);
      setStatsByDay([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [summary, byDay] = await Promise.all([
        getAccountOutreachMetrics(account.id, startDate, endDate),
        getAccountOutreachStatsByDay(account.id, startDate, endDate),
      ]);
      setMetrics(summary);
      setStatsByDay(fillMissingStatsByDay(byDay, startDate, endDate));
    } catch (e) {
      setMetrics(null);
      setStatsByDay([]);
      setError(e instanceof Error ? e.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, [account?.id, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const showWarning =
    metrics?.smartleadImportWarning === true && !warningDismissed;

  return (
    <PageLayout>
      <PageHeader
        title="Outreach metrics"
        subtitle="Furnace sends and replies for your campaigns (UTC dates)"
      />

      <View className="flex-row flex-wrap items-end gap-3 mb-6">
        <DateInput
          label="From"
          value={startDate}
          onChange={setStartDate}
          max={endDate}
          disabled={loading}
        />
        <DateInput
          label="To"
          value={endDate}
          onChange={setEndDate}
          min={startDate}
          disabled={loading}
        />
      </View>

      {error ? (
        <Alert variant="error" message={error} actionText="Retry" onAction={load} className="mb-4" />
      ) : null}

      {showWarning ? (
        <Alert
          variant="warning"
          message="A Smartlead import finished on or after the start of this range. These totals only include activity from campaigns sent through Furnace, not historical Smartlead sends."
          actionText="Dismiss"
          onAction={() => setWarningDismissed(true)}
          className="mb-4"
        />
      ) : null}

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="flex-row flex-wrap gap-4 mb-8">
          <MetricCard
            title="Total sent"
            subtitle="Emails (not deduped by lead)"
            icon={PaperAirplaneIcon}
            color="#a78bfa"
            value={metrics?.totalSent}
            loading={loading}
          />
          <MetricCard
            title="Total positive replies"
            subtitle="Interested (event count)"
            icon={CheckCircleIcon}
            color="#10b981"
            value={metrics?.totalPositiveReply}
            loading={loading}
          />
          <MetricCard
            title="Leads reached"
            subtitle="Unique leads across campaigns"
            icon={UserGroupIcon}
            color="#38bdf8"
            value={metrics?.leadsReached}
            loading={loading}
          />
          <MetricCard
            title="Leads in queue"
            subtitle="Active, running, not yet sent"
            icon={ClockIcon}
            color="#f59e0b"
            value={metrics?.leadsInQueue}
            loading={loading}
          />
        </View>

        <View className="mb-8">
          <Text className="text-lg font-instrument-semibold text-white mb-4">Daily activity</Text>
          <CampaignStatsChart data={statsByDay} loading={loading} />
        </View>
      </ScrollView>
    </PageLayout>
  );
}

function MetricCard({
  title,
  subtitle,
  icon: Icon,
  color,
  value,
  loading,
}: {
  title: string;
  subtitle: string;
  icon: ComponentType<{ size?: number; color?: string }>;
  color: string;
  value: number | undefined;
  loading: boolean;
}) {
  const display =
    loading || value === undefined ? '—' : formatInt(value);
  return (
    <Card variant="card" className="flex-1 min-w-[140px] max-w-[220px] p-4">
      <View className="flex-row items-center gap-2 mb-2">
        <Icon size={18} color={color} />
        <Text className="text-white font-instrument-semibold text-base flex-1" numberOfLines={2}>
          {title}
        </Text>
      </View>
      <Text className="text-gray-500 font-instrument text-xs mb-3">{subtitle}</Text>
      <Text className="font-instrument-semibold text-3xl" style={{ color }}>
        {display}
      </Text>
    </Card>
  );
}
