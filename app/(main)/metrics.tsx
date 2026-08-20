import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PageLayout,
  PageHeader,
  LAYOUT_BREAKPOINT,
} from '@/components/ui/layout';
import { BottomSheet, getBottomSheetBodyScrollMaxHeight, getBottomSheetExpandedBodyHeight } from '@/components/ui/modals';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/feedback';
import { AccountMetricsToolbar } from '@/components/campaigns/AccountMetricsToolbar';
import { AccountTrendChart } from '@/components/campaigns/AccountTrendChart';
import { CopyPerformancePanel } from '@/components/campaigns/copyPerformance';
import { useAccount } from '@/contexts/AccountContext';
import { fillMissingStatsByDay } from '@/lib/campaigns/fillMissingStatsByDay';
import { CAMPAIGN_STAT_COLORS } from '@/lib/campaigns/campaignStatColors';
import { defaultMetricsDateRange, trendChartGrain } from '@/lib/metrics/accountMetricsDateRange';
import {
  countPerOutcome,
  formatCountPerOutcome,
  formatRate,
} from '@/lib/metrics/lowVolume';
import { formatRunwayThrough, queueRunwayEndDate } from '@/lib/metrics/runway';
import { formatWeekLabel, rollupDailyToIsoWeeks } from '@/lib/metrics/weeklyRollup';
import {
  getAccountDailyOutreachVolume,
  getAccountCopyStats,
  getAccountOutreachMetrics,
  getAccountOutreachStatsByDay,
  getAccountQueueSendCapacity,
  getAccountWeeklyOutreachVolume,
  getCampaignsListSummary,
  type AccountOutreachMetrics,
  type AccountCopyStats,
  type CampaignListSummary,
  type CampaignStatsByDay,
} from '@/lib/supabase/services/campaigns';
import type { QueueSendCapacity } from '@/lib/metrics/queueSendCapacity';
import { FunnelIcon } from 'react-native-heroicons/outline';
import { kickCopyParseFromClient } from '@/lib/copy/kickCopyParse';

type OutreachVolumePoint = {
  periodStart: string;
  emailsSent: number;
  leadsFirstContacted: number;
};

const INTEGER_FORMATTER = new Intl.NumberFormat('en-US');

function formatInt(n: number): string {
  return INTEGER_FORMATTER.format(n);
}
export default function AccountMetricsPage() {
  const { account } = useAccount();
  const { width, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const sheetBodyMaxHeight = getBottomSheetBodyScrollMaxHeight(screenHeight, insets.bottom);
  const METRICS_FILTERS_BODY_HEIGHT_FRACTION = 0.72;
  const filtersExpandedBodyHeight = useMemo(
    () => getBottomSheetExpandedBodyHeight(sheetBodyMaxHeight, METRICS_FILTERS_BODY_HEIGHT_FRACTION),
    [sheetBodyMaxHeight],
  );
  const [filtersSheetOpen, setFiltersSheetOpen] = useState(false);
  const initialRange = useMemo(() => defaultMetricsDateRange(), []);
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);
  const [campaignOptions, setCampaignOptions] = useState<CampaignListSummary[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [metrics, setMetrics] = useState<AccountOutreachMetrics | null>(null);
  const [statsByDay, setStatsByDay] = useState<CampaignStatsByDay[]>([]);
  const [outreachVolume, setOutreachVolume] = useState<OutreachVolumePoint[]>([]);
  const [sendCapacity, setSendCapacity] = useState<QueueSendCapacity | null>(null);
  const [copyStats, setCopyStats] = useState<AccountCopyStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);

  const onChangeRange = useCallback((start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  }, []);

  useEffect(() => {
    setSelectedCampaignIds([]);
    setCampaignOptions([]);
  }, [account?.id]);

  useEffect(() => {
    if (!account?.id) return;
    let cancelled = false;
    setCampaignsLoading(true);
    getCampaignsListSummary(account.id)
      .then((rows) => {
        if (cancelled) return;
        setCampaignOptions(rows.filter((c) => c.source !== 'smartlead'));
      })
      .catch(() => {
        if (!cancelled) setCampaignOptions([]);
      })
      .finally(() => {
        if (!cancelled) setCampaignsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account?.id]);

  useEffect(() => {
    setWarningDismissed(false);
  }, [account?.id, startDate, endDate, selectedCampaignIds]);

  const load = useCallback(async () => {
    if (!account?.id) return;
    if (!startDate || !endDate) return;
    if (startDate > endDate) {
      setError('Start date must be on or before end date.');
      setMetrics(null);
      setStatsByDay([]);
      setOutreachVolume([]);
      setSendCapacity(null);
      setCopyStats(null);
      return;
    }
    setLoading(true);
    setError(null);
    const campaignFilter =
      selectedCampaignIds.length > 0 ? selectedCampaignIds : undefined;
    const grain = trendChartGrain(startDate, endDate);
    try {
      const [summary, byDay, volume, capacity, copy] = await Promise.all([
        getAccountOutreachMetrics(account.id, startDate, endDate, campaignFilter),
        getAccountOutreachStatsByDay(account.id, startDate, endDate, campaignFilter),
        grain === 'day'
          ? getAccountDailyOutreachVolume(account.id, startDate, endDate, campaignFilter)
          : getAccountWeeklyOutreachVolume(account.id, startDate, endDate, campaignFilter),
        getAccountQueueSendCapacity(account.id, campaignFilter),
        getAccountCopyStats(account.id, startDate, endDate, campaignFilter),
      ]);
      setMetrics(summary);
      setStatsByDay(fillMissingStatsByDay(byDay, startDate, endDate));
      setSendCapacity(capacity);
      setCopyStats(copy);
      if (copy.copyBacklog > 0) {
        void kickCopyParseFromClient(account.id);
      }
      setOutreachVolume(
        volume.map((row) =>
          'date' in row
            ? {
                periodStart: row.date,
                emailsSent: row.emailsSent,
                leadsFirstContacted: row.leadsFirstContacted,
              }
            : {
                periodStart: row.weekStart,
                emailsSent: row.emailsSent,
                leadsFirstContacted: row.leadsFirstContacted,
              },
        ),
      );
    } catch (e) {
      setMetrics(null);
      setStatsByDay([]);
      setOutreachVolume([]);
      setSendCapacity(null);
      setCopyStats(null);
      setError(e instanceof Error ? e.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, [account?.id, startDate, endDate, selectedCampaignIds]);

  useEffect(() => {
    load();
  }, [load]);

  const metricsToolbarProps = {
    startDate,
    endDate,
    onChangeRange,
    campaignIds: selectedCampaignIds,
    onChangeCampaignIds: setSelectedCampaignIds,
    campaignOptions,
    loading,
    campaignsLoading,
  };

  const hasActiveFilters = selectedCampaignIds.length > 0;

  const totals = useMemo(() => {
    const sent = statsByDay.reduce((s, d) => s + d.sent, 0);
    const replied = statsByDay.reduce((s, d) => s + d.replied, 0);
    return { sent, replied };
  }, [statsByDay]);

  const grain = useMemo(() => trendChartGrain(startDate, endDate), [startDate, endDate]);
  const weeklyOutcomes = useMemo(() => rollupDailyToIsoWeeks(statsByDay), [statsByDay]);
  const trendPeriods = useMemo(
    () =>
      grain === 'day'
        ? statsByDay.map((day) => day.date)
        : weeklyOutcomes.map((week) => week.weekStart),
    [grain, statsByDay, weeklyOutcomes],
  );
  const volumeByPeriod = useMemo(
    () => new Map(outreachVolume.map((point) => [point.periodStart, point])),
    [outreachVolume],
  );
  const outcomeByPeriod = useMemo(() => {
    if (grain === 'day') {
      return new Map(
        statsByDay.map((day) => [day.date, { replied: day.replied, interested: day.positiveReply }]),
      );
    }
    return new Map(
      weeklyOutcomes.map((week) => [
        week.weekStart,
        { replied: week.replied, interested: week.positiveReply },
      ]),
    );
  }, [grain, statsByDay, weeklyOutcomes]);
  const trendLabels = useMemo(
    () => trendPeriods.map((period) => formatWeekLabel(period)),
    [trendPeriods],
  );
  const trendPanels = useMemo(
    () => [
      {
        series: [
          {
            name: 'Emails sent',
            color: CAMPAIGN_STAT_COLORS.sent,
            data: trendPeriods.map((period) => volumeByPeriod.get(period)?.emailsSent ?? 0),
          },
          {
            name: 'Leads reached',
            color: '#38bdf8',
            data: trendPeriods.map((period) => volumeByPeriod.get(period)?.leadsFirstContacted ?? 0),
          },
        ],
      },
      {
        series: [
          {
            name: 'Replies',
            color: CAMPAIGN_STAT_COLORS.replied,
            data: trendPeriods.map((period) => outcomeByPeriod.get(period)?.replied ?? 0),
          },
          {
            name: 'Interested',
            color: CAMPAIGN_STAT_COLORS.positiveReply,
            data: trendPeriods.map((period) => outcomeByPeriod.get(period)?.interested ?? 0),
          },
        ],
      },
    ],
    [trendPeriods, volumeByPeriod, outcomeByPeriod],
  );

  const runwayEndDate = useMemo(
    () =>
      metrics && sendCapacity
        ? queueRunwayEndDate(metrics.leadsInQueue, sendCapacity.dailyEmails)
        : null,
    [metrics, sendCapacity],
  );

  const headerActions = isMobile ? (
    <View>
      <Pressable
        onPress={() => setFiltersSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Filters"
        className="rounded-xl items-center justify-center"
        style={{
          width: 44,
          height: 44,
          backgroundColor: '#1A1A1A',
          borderColor: '#2A2A2A',
          borderWidth: 1,
        }}
      >
        <FunnelIcon size={18} color={hasActiveFilters ? '#F3440D' : '#9CA3AF'} />
      </Pressable>
    </View>
  ) : (
    <View className="min-w-0 max-w-[min(100%,920px)] shrink">
      <AccountMetricsToolbar {...metricsToolbarProps} />
    </View>
  );

  const alerts =
    error || (metrics?.smartleadImportWarning === true && !warningDismissed) ? (
      <View className="gap-3 mb-6">
        {error ? (
          <Alert variant="error" message={error} actionText="Retry" onAction={load} />
        ) : null}
        {metrics?.smartleadImportWarning === true && !warningDismissed ? (
          <Alert
            variant="warning"
            message="A Smartlead import finished on or after the start of this range. These totals only include activity from campaigns sent through Furnace, not historical Smartlead sends."
            actionText="Dismiss"
            onAction={() => setWarningDismissed(true)}
          />
        ) : null}
      </View>
    ) : null;

  const reached = metrics?.leadsReached ?? 0;
  const interested = metrics?.totalPositiveReply ?? 0;
  const queue = metrics?.leadsInQueue ?? 0;
  const leadsPerPositiveReply = countPerOutcome(reached, interested);
  const emailsPerPositiveReply = countPerOutcome(totals.sent, interested);

  return (
    <PageLayout>
      <PageHeader
        title="Metrics"
        subtitle={isMobile ? 'Sends, replies, and queue (UTC)' : 'Furnace sends, replies, and queue for your campaigns (UTC dates)'}
        primaryAction={headerActions}
      />
      {alerts}

      <View className="flex-row flex-wrap gap-3 mb-8">
        <MetricCard
          label="Leads reached"
          value={loading ? '—' : formatInt(reached)}
          color="#38bdf8"
        />
        <MetricCard
          label="Emails sent"
          value={loading ? '—' : formatInt(totals.sent)}
          color={CAMPAIGN_STAT_COLORS.sent}
        />
        <MetricCard
          label="Replies"
          value={loading ? '—' : formatInt(totals.replied)}
          hint={loading ? null : `${formatRate(totals.replied, reached, 1)} of reached`}
          color={CAMPAIGN_STAT_COLORS.replied}
        />
        <MetricCard
          label="Interested"
          value={loading ? '—' : formatInt(interested)}
          hint={loading ? null : `${formatRate(interested, totals.replied, 1)} of replies`}
          color={CAMPAIGN_STAT_COLORS.positiveReply}
        />
        <MetricCard
          label="Leads per positive reply"
          value={loading ? '—' : formatCountPerOutcome(leadsPerPositiveReply)}
          hint={
            loading || interested <= 0
              ? null
              : `${formatInt(reached)} reached / ${formatInt(interested)} interested`
          }
          color="#38bdf8"
        />
        <MetricCard
          label="Emails per positive reply"
          value={loading ? '—' : formatCountPerOutcome(emailsPerPositiveReply)}
          hint={
            loading || interested <= 0
              ? null
              : `${formatInt(totals.sent)} sent / ${formatInt(interested)} interested`
          }
          color={CAMPAIGN_STAT_COLORS.positiveReply}
        />
        <MetricCard
          label="Queue"
          value={loading ? '—' : formatInt(queue)}
          hint={
            loading
              ? null
              : formatRunwayThrough(runwayEndDate) ??
                (queue > 0 ? 'No send capacity' : 'No unsent leads')
          }
          color="#f59e0b"
        />
      </View>

      <Text className="text-lg font-instrument-semibold text-white mb-1">
        {grain === 'day' ? 'Daily trends' : 'Weekly trends'}
      </Text>
      <Text className="text-gray-400 font-instrument text-sm mb-4">
        {grain === 'day' ? 'Hover a day for exact counts.' : 'Hover a week for exact counts.'}
      </Text>
      <View className="mb-8">
        <AccountTrendChart
          categoryKind={grain}
          categories={trendLabels}
          panels={trendPanels}
          loading={loading}
        />
      </View>

      <View className="flex-row items-center gap-2 mb-1">
        <Text className="text-lg font-instrument-semibold text-white">
          Copy performance
        </Text>
        <View className="rounded px-1.5 py-0.5 shrink-0" style={{ backgroundColor: '#f85102' }}>
          <Text className="text-[10px] font-instrument-semibold uppercase tracking-wide text-white">
            Beta
          </Text>
        </View>
      </View>
      <Text className="text-gray-400 font-instrument text-sm mb-4">
        Which hooks, offers, and CTAs correlate with interested replies. Rates are per send.
      </Text>
      <View className="mb-8">
        <CopyPerformancePanel stats={copyStats} loading={loading} />
      </View>

      {isMobile ? (
        <BottomSheet
          visible={filtersSheetOpen}
          onClose={() => setFiltersSheetOpen(false)}
          expandBodyToMax
          expandBodyHeightFraction={METRICS_FILTERS_BODY_HEIGHT_FRACTION}
        >
          <ScrollView
            style={{ flex: 1, minHeight: 0, maxHeight: filtersExpandedBodyHeight }}
            contentContainerStyle={{ paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            <AccountMetricsToolbar variant="sheet" {...metricsToolbarProps} />
          </ScrollView>
        </BottomSheet>
      ) : null}
    </PageLayout>
  );
}
function MetricCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string | null;
  color?: string;
}) {
  return (
    <Card variant="card" className="min-w-[160px] flex-1">
      <Text className="text-gray-400 font-instrument text-xs mb-2">{label}</Text>
      <Text className="text-2xl font-instrument-semibold" style={{ color: color ?? '#FFFFFF' }}>
        {value}
      </Text>
      {hint ? (
        <Text className="text-gray-500 font-instrument text-xs mt-1.5">{hint}</Text>
      ) : null}
    </Card>
  );
}