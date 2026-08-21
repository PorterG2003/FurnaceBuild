import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PageLayout,
  PageHeader,
  LAYOUT_BREAKPOINT,
} from '@/components/ui/layout';
import { BottomSheet, getBottomSheetBodyScrollMaxHeight, getBottomSheetExpandedBodyHeight } from '@/components/ui/modals';
import { Card } from '@/components/ui/Card';
import { Alert, usePageSkeleton } from '@/components/ui/feedback';
import { AccountMetricsToolbar } from '@/components/campaigns/AccountMetricsToolbar';
import { AccountTrendChart } from '@/components/campaigns/AccountTrendChart';
import { CopyPerformancePanel } from '@/components/campaigns/copyPerformance';
import { MetricCardsSkeleton } from '@/components/skeletons';
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
  getAccountCopyStats,
  getAccountOutreachMetrics,
  getAccountOutreachStatsByDay,
  getAccountQueueSendCapacity,
  getCampaignsListSummary,
  type AccountOutreachMetrics,
  type AccountCopyStats,
  type CampaignListSummary,
  type CampaignStatsByDay,
} from '@/lib/supabase/services/campaigns';
import type { QueueSendCapacity } from '@/lib/metrics/queueSendCapacity';
import { FunnelIcon } from 'react-native-heroicons/outline';
import { kickCopyParseFromClient } from '@/lib/copy/kickCopyParse';

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
  const [sendCapacity, setSendCapacity] = useState<QueueSendCapacity | null>(null);
  const [copyStats, setCopyStats] = useState<AccountCopyStats | null>(null);
  const [heroLoading, setHeroLoading] = useState(false);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [heroError, setHeroError] = useState<string | null>(null);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const heroGen = useRef(0);
  const trendsGen = useRef(0);
  const copyGen = useRef(0);
  const [warningDismissed, setWarningDismissed] = useState(false);

  const onChangeRange = useCallback((start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  }, []);

  const rangeInvalid = Boolean(startDate && endDate && startDate > endDate);

  useEffect(() => {
    setSelectedCampaignIds([]);
    setCampaignOptions([]);
    setMetrics(null);
    setStatsByDay([]);
    setSendCapacity(null);
    setCopyStats(null);
    setHeroError(null);
    setTrendsError(null);
    setCopyError(null);
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

  const loadHero = useCallback(async () => {
    if (!account?.id || !startDate || !endDate || rangeInvalid) return;
    const gen = ++heroGen.current;
    setHeroLoading(true);
    setHeroError(null);
    try {
      const [summary, capacity] = await Promise.all([
        getAccountOutreachMetrics(
          account.id,
          startDate,
          endDate,
          selectedCampaignIds.length > 0 ? selectedCampaignIds : undefined,
        ),
        getAccountQueueSendCapacity(
          account.id,
          selectedCampaignIds.length > 0 ? selectedCampaignIds : undefined,
        ),
      ]);
      if (gen !== heroGen.current) return;
      setMetrics(summary);
      setSendCapacity(capacity);
    } catch (e) {
      if (gen !== heroGen.current) return;
      setHeroError(e instanceof Error ? e.message : 'Failed to load metrics');
    } finally {
      if (gen === heroGen.current) setHeroLoading(false);
    }
  }, [account?.id, startDate, endDate, rangeInvalid, selectedCampaignIds]);

  const loadTrends = useCallback(async () => {
    if (!account?.id || !startDate || !endDate || rangeInvalid) return;
    const gen = ++trendsGen.current;
    setTrendsLoading(true);
    setTrendsError(null);
    try {
      const byDay = await getAccountOutreachStatsByDay(
        account.id,
        startDate,
        endDate,
        selectedCampaignIds.length > 0 ? selectedCampaignIds : undefined,
      );
      if (gen !== trendsGen.current) return;
      setStatsByDay(fillMissingStatsByDay(byDay, startDate, endDate));
    } catch (e) {
      if (gen !== trendsGen.current) return;
      setTrendsError(e instanceof Error ? e.message : 'Failed to load trends');
    } finally {
      if (gen === trendsGen.current) setTrendsLoading(false);
    }
  }, [account?.id, startDate, endDate, rangeInvalid, selectedCampaignIds]);

  const loadCopy = useCallback(async () => {
    if (!account?.id || !startDate || !endDate || rangeInvalid) return;
    const gen = ++copyGen.current;
    setCopyLoading(true);
    setCopyError(null);
    try {
      const copy = await getAccountCopyStats(
        account.id,
        startDate,
        endDate,
        selectedCampaignIds.length > 0 ? selectedCampaignIds : undefined,
      );
      if (gen !== copyGen.current) return;
      setCopyStats(copy);
      if (copy.copyBacklog > 0) {
        void kickCopyParseFromClient(account.id);
      }
    } catch (e) {
      if (gen !== copyGen.current) return;
      setCopyError(e instanceof Error ? e.message : 'Failed to load copy performance');
    } finally {
      if (gen === copyGen.current) setCopyLoading(false);
    }
  }, [account?.id, startDate, endDate, rangeInvalid, selectedCampaignIds]);

  useEffect(() => {
    if (rangeInvalid) {
      setHeroError('Start date must be on or before end date.');
      setTrendsError(null);
      setCopyError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      await loadHero();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHero, rangeInvalid]);

  useEffect(() => {
    if (rangeInvalid) return;
    let cancelled = false;
    void (async () => {
      await loadTrends();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTrends, rangeInvalid]);

  useEffect(() => {
    if (rangeInvalid) return;
    let cancelled = false;
    void (async () => {
      await loadCopy();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCopy, rangeInvalid]);

  const metricsToolbarProps = {
    startDate,
    endDate,
    onChangeRange,
    campaignIds: selectedCampaignIds,
    onChangeCampaignIds: setSelectedCampaignIds,
    campaignOptions,
    campaignsLoading,
  };

  const hasActiveFilters = selectedCampaignIds.length > 0;
  const { showPlaceholder: showHeroSkeleton } = usePageSkeleton(heroLoading && !metrics);
  const { showPlaceholder: showTrendsSkeleton } = usePageSkeleton(trendsLoading && statsByDay.length === 0);
  const { showPlaceholder: showCopySkeleton } = usePageSkeleton(copyLoading && !copyStats);

  const grain = useMemo(() => trendChartGrain(startDate, endDate), [startDate, endDate]);
  const weeklyOutcomes = useMemo(() => rollupDailyToIsoWeeks(statsByDay), [statsByDay]);
  const trendPeriods = useMemo(
    () =>
      grain === 'day'
        ? statsByDay.map((day) => day.date)
        : weeklyOutcomes.map((week) => week.weekStart),
    [grain, statsByDay, weeklyOutcomes],
  );
  const volumeByPeriod = useMemo(() => {
    if (grain === 'day') {
      return new Map(
        statsByDay.map((day) => [
          day.date,
          { emailsSent: day.sent, leadsFirstContacted: day.leadsFirstContacted },
        ]),
      );
    }
    return new Map(
      weeklyOutcomes.map((week) => [
        week.weekStart,
        { emailsSent: week.sent, leadsFirstContacted: week.leadsFirstContacted },
      ]),
    );
  }, [grain, statsByDay, weeklyOutcomes]);
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

  const alerts = (
    <View className="gap-3 mb-6">
      {heroError ? (
        <Alert variant="error" message={heroError} actionText="Retry" onAction={loadHero} />
      ) : null}
      {trendsError ? (
        <Alert variant="error" message={trendsError} actionText="Retry" onAction={loadTrends} />
      ) : null}
      {copyError ? (
        <Alert variant="error" message={copyError} actionText="Retry" onAction={loadCopy} />
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
  );

  const reached = metrics?.leadsReached ?? 0;
  const sent = metrics?.totalSent ?? 0;
  const replied = metrics?.totalReplied ?? 0;
  const interested = metrics?.totalPositiveReply ?? 0;
  const queue = metrics?.leadsInQueue ?? 0;
  const leadsPerPositiveReply = countPerOutcome(reached, interested);
  const emailsPerPositiveReply = countPerOutcome(sent, interested);
  const heroBusy = showHeroSkeleton;

  return (
    <PageLayout>
      <PageHeader
        title="Metrics"
        subtitle={isMobile ? 'Sends, replies, and queue (UTC)' : 'Furnace sends, replies, and queue for your campaigns (UTC dates)'}
        primaryAction={headerActions}
      />
      {heroError || trendsError || copyError || (metrics?.smartleadImportWarning === true && !warningDismissed)
        ? alerts
        : null}

      {heroBusy ? (
        <MetricCardsSkeleton />
      ) : (
        <View className="flex-row flex-wrap gap-3 mb-8">
          <MetricCard
            label="Leads reached"
            value={formatInt(reached)}
            color="#38bdf8"
          />
          <MetricCard
            label="Emails sent"
            value={formatInt(sent)}
            color={CAMPAIGN_STAT_COLORS.sent}
          />
          <MetricCard
            label="Replies"
            value={formatInt(replied)}
            hint={`${formatRate(replied, reached, 1)} of reached`}
            color={CAMPAIGN_STAT_COLORS.replied}
          />
          <MetricCard
            label="Interested"
            value={formatInt(interested)}
            hint={`${formatRate(interested, replied, 1)} of replies`}
            color={CAMPAIGN_STAT_COLORS.positiveReply}
          />
          <MetricCard
            label="Leads per positive reply"
            value={formatCountPerOutcome(leadsPerPositiveReply)}
            hint={
              interested <= 0
                ? null
                : `${formatInt(reached)} reached / ${formatInt(interested)} interested`
            }
            color="#38bdf8"
          />
          <MetricCard
            label="Emails per positive reply"
            value={formatCountPerOutcome(emailsPerPositiveReply)}
            hint={
              interested <= 0
                ? null
                : `${formatInt(sent)} sent / ${formatInt(interested)} interested`
            }
            color={CAMPAIGN_STAT_COLORS.positiveReply}
          />
          <MetricCard
            label="Queue"
            value={formatInt(queue)}
            hint={
              formatRunwayThrough(runwayEndDate) ??
              (queue > 0 ? 'No send capacity' : 'No unsent leads')
            }
            color="#f59e0b"
          />
        </View>
      )}

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
          loading={showTrendsSkeleton}
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
        <CopyPerformancePanel stats={copyStats} loading={showCopySkeleton} />
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